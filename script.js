//config.js
// Google Apps Script for Ministry Portal Authentication System
const SHEET_ID = '1NUrtHTBm4F3JTq9AXOsJXVfp2uLDtdfItCzOpK733fw';

// Sheet Names
const SHEET_NAMES = {
  ACCOUNTS: 'Accounts',
  PRAISE_WORSHIP: 'Praise & Worship Song'
};

// Response Status
const STATUS = {
  UNVERIFIED: 'unverified',
  VERIFIED: 'verified',
  FOR_APPROVAL: 'For Approval',
  APPROVED: 'Approved'
};

//handlers.js
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  let result;
  
  try {
    if (action === 'checkStatus') {
      result = handleCheckStatus(e);
    } else if (action === 'getScheduleByDate') {
      result = getScheduleByDate(e.parameter.date);
    } else if (action === 'getScheduleById') {
      result = getScheduleById(e.parameter.id);
    } else if (action === 'getSchedules') {
      result = getSchedules();
    } else if (action === 'checkSchedule') {
      result = checkSchedule(e.parameter.date);
    } else if (action === 'deleteSchedule') {
      result = deleteSchedule(e.parameter.id);
    } else if (action === 'createSchedule') {
      result = handleCreateSchedule(e);
    } else if (action === 'getUserSchedules') {
      result = handleGetUserSchedules(e);
    } else if (action === 'getUnverifiedUsers') {
      result = getUnverifiedUsers();
    } else if (action === 'verifyUser') {
      result = verifyUser(e.parameter.username);
    } else {
      result = { success: true, message: 'Ministry Portal API is running' };
    }
  } catch (error) {
    Logger.log('doGet Error: ' + error.toString());
    result = { success: false, message: 'Server error: ' + error.toString() };
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let result;
  
  try {
    let data = {};
    
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      data = e.parameter;
    }
    
    const action = e && e.parameter && e.parameter.action;
    
    if (action === 'login') {
      result = handleLogin(data);
    } else if (action === 'signup') {
      result = handleSignup(data);
    } else if (action === 'createSchedule') {
      result = handleCreateSchedule(data);
    } else if (action === 'getUserSchedules') {
      result = handleGetUserSchedules(data);
    } else if (action === 'saveSchedule') {
      result = saveSchedule(data);
    } else {
      result = createResponse(false, 'Invalid action');
    }
  } catch (error) {
    Logger.log('doPost Error: ' + error.toString());
    result = { success: false, message: 'Server error: ' + error.toString() };
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}


//auth.js
function handleLogin(data) {
  try {
    if (!data || !data.username || !data.password) {
      return createResponse(false, 'Missing username or password');
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const accountsSheet = ss.getSheetByName(SHEET_NAMES.ACCOUNTS);
    
    if (!accountsSheet) {
      return createResponse(false, 'Accounts sheet not found');
    }
    
    const dataRange = accountsSheet.getDataRange();
    const values = dataRange.getValues();
    
    var hashedPassword = hashPassword(data.password);
    
    for (var i = 1; i < values.length; i++) {
      const row = values[i];
      const username = row[6]; // Column G (index 6)
      const storedPasswordHash = row[7]; // Column H (index 7)
      const status = row[10] || STATUS.UNVERIFIED; // Column K (index 10)
      
      if (username === data.username && storedPasswordHash === hashedPassword) {
        const userData = {
          memberId: row[1],
          firstname: row[2],
          lastname: row[3],
          birthdate: row[4],
          ministry: row[5],
          username: row[6],
          status: status
        };
        
        return createResponse(true, 'Login successful', userData);
      }
    }
    
    return createResponse(false, 'Invalid username or password');
  } catch (error) {
    Logger.log('Login error: ' + error.toString());
    return createResponse(false, 'Login error: ' + error.toString());
  }
}

function handleSignup(data) {
  try {
    if (!data || !data.username || !data.password || !data.confirmPassword) {
      return createResponse(false, 'Missing signup fields (username/password/confirmPassword)');
    }
    if (data.password !== data.confirmPassword) {
      return createResponse(false, 'Password and Confirm Password do not match');
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const accountsSheet = ss.getSheetByName(SHEET_NAMES.ACCOUNTS);
    
    if (!accountsSheet) {
      return createResponse(false, 'Accounts sheet not found');
    }
    
    const dataRange = accountsSheet.getDataRange();
    const values = dataRange.getValues();
    
    for (var i = 1; i < values.length; i++) {
      if (values[i][6] === data.username) {
        return createResponse(false, 'Username already exists');
      }
    }
    
    const memberId = generateMemberId();
    const timestamp = new Date();
    const hashedPassword = hashPassword(data.password);
    const hashedConfirmPassword = hashPassword(data.confirmPassword);
    const status = STATUS.UNVERIFIED;
    
    const newRow = [
      timestamp,
      memberId,
      data.firstname || '',
      data.lastname || '',
      data.birthdate || '',
      data.ministry || '',
      data.username,
      hashedPassword,
      hashedConfirmPassword,
      data.terms ? 'Accepted' : 'Not Accepted',
      status
    ];
    
    accountsSheet.appendRow(newRow);
    
    return createResponse(true, 'Account created successfully! Please wait for verification. An administrator will verify your account soon.', {
      memberId: memberId,
      username: data.username,
      status: status
    });
  } catch (error) {
    Logger.log('Signup error: ' + error.toString());
    return createResponse(false, 'Signup error: ' + error.toString());
  }
}

function handleCheckStatus(e) {
  try {
    const username = e && e.parameter && e.parameter.username;
    if (!username) return createResponse(false, 'Missing username parameter');

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const accountsSheet = ss.getSheetByName(SHEET_NAMES.ACCOUNTS);
    
    if (!accountsSheet) {
      return createResponse(false, 'Accounts sheet not found');
    }
    
    const dataRange = accountsSheet.getDataRange();
    const values = dataRange.getValues();
    
    for (var i = 1; i < values.length; i++) {
      const row = values[i];
      if (row[6] === username) {
        const currentStatus = row[10] || STATUS.UNVERIFIED; // Column K is index 10
        
        return createResponse(true, 'Status check successful', {
          username: username,
          status: currentStatus
        });
      }
    }
    
    return createResponse(false, 'User not found');
  } catch (error) {
    Logger.log('Check status error: ' + error.toString());
    return createResponse(false, 'Error checking status: ' + error.toString());
  }
}


//schedule.js
function handleCreateSchedule(data) {
  try {
    // Handle both POST data and GET parameters
    let scheduleData = data;
    
    // If data is from GET request (parameters), use it directly
    if (typeof data === 'object' && data.parameter) {
      scheduleData = data.parameter;
    }
    
    if (!scheduleData || !scheduleData.songLeader || !scheduleData.scheduleDay) {
      return createResponse(false, 'Missing required fields: songLeader and scheduleDay');
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const scheduleSheet = ss.getSheetByName(SHEET_NAMES.PRAISE_WORSHIP);
    
    if (!scheduleSheet) {
      return createResponse(false, 'Praise & Worship Song sheet not found');
    }

    const scheduleId = generateScheduleId();
    const timestamp = getManilaTime();
    
    // Build the row data according to your sheet structure
    const newRow = [
      timestamp, // A - Timestamp
      scheduleId, // B - ScheduleID
      scheduleData.songLeader, // C - Song Leader
      scheduleData.scheduleDay, // D - Schedule Day
      // Slow Songs (5 songs, 4 columns each = 20 columns)
      scheduleData.slow1Title || '', scheduleData.slow1Link || '', scheduleData.slow1Lyrics || '', scheduleData.slow1Instructions || '',
      scheduleData.slow2Title || '', scheduleData.slow2Link || '', scheduleData.slow2Lyrics || '', scheduleData.slow2Instructions || '',
      scheduleData.slow3Title || '', scheduleData.slow3Link || '', scheduleData.slow3Lyrics || '', scheduleData.slow3Instructions || '',
      scheduleData.slow4Title || '', scheduleData.slow4Link || '', scheduleData.slow4Lyrics || '', scheduleData.slow4Instructions || '',
      scheduleData.slow5Title || '', scheduleData.slow5Link || '', scheduleData.slow5Lyrics || '', scheduleData.slow5Instructions || '',
      // Fast Songs (5 songs, 4 columns each = 20 columns)
      scheduleData.fast1Title || '', scheduleData.fast1Link || '', scheduleData.fast1Lyrics || '', scheduleData.fast1Instructions || '',
      scheduleData.fast2Title || '', scheduleData.fast2Link || '', scheduleData.fast2Lyrics || '', scheduleData.fast2Instructions || '',
      scheduleData.fast3Title || '', scheduleData.fast3Link || '', scheduleData.fast3Lyrics || '', scheduleData.fast3Instructions || '',
      scheduleData.fast4Title || '', scheduleData.fast4Link || '', scheduleData.fast4Lyrics || '', scheduleData.fast4Instructions || '',
      scheduleData.fast5Title || '', scheduleData.fast5Link || '', scheduleData.fast5Lyrics || '', scheduleData.fast5Instructions || '',
      STATUS.FOR_APPROVAL // AS - Submission Status
    ];
    
    // Append to row 3 (since data starts at row 3)
    scheduleSheet.getRange(scheduleSheet.getLastRow() + 1, 1, 1, newRow.length).setValues([newRow]);
    
    return createResponse(true, 'Schedule created successfully! Waiting for approval.', {
      scheduleId: scheduleId,
      scheduleDay: scheduleData.scheduleDay,
      status: STATUS.FOR_APPROVAL
    });
  } catch (error) {
    Logger.log('Create schedule error: ' + error.toString());
    return createResponse(false, 'Error creating schedule: ' + error.toString());
  }
}

function handleGetUserSchedules(data) {
  try {
    // Handle both POST data and GET parameters
    let requestData = data;
    
    // If data is from GET request (parameters), use it directly
    if (typeof data === 'object' && data.parameter) {
      requestData = data.parameter;
    }
    
    if (!requestData || !requestData.username) {
      return createResponse(false, 'Missing username');
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const scheduleSheet = ss.getSheetByName(SHEET_NAMES.PRAISE_WORSHIP);
    
    if (!scheduleSheet) {
      return createResponse(false, 'Praise & Worship Song sheet not found');
    }

    const dataRange = scheduleSheet.getDataRange();
    const values = dataRange.getValues();
    
    const userSchedules = [];
    
    // Start from row 3 (index 2) since data starts at row 3
    for (var i = 2; i < values.length; i++) {
      const row = values[i];
      const songLeader = row[2];
      
      if (songLeader === requestData.username) {
        const schedule = {
          timestamp: row[0],
          scheduleId: row[1],
          songLeader: row[2],
          scheduleDay: row[3],
          status: row[44] || STATUS.FOR_APPROVAL,
          slowSongs: [],
          fastSongs: []
        };
        
        // Parse slow songs (columns E-X, indices 4-23)
        for (let j = 0; j < 5; j++) {
          const baseIndex = 4 + (j * 4);
          if (row[baseIndex] && row[baseIndex].toString().trim() !== '') {
            schedule.slowSongs.push({
              title: row[baseIndex],
              link: row[baseIndex + 1],
              lyrics: row[baseIndex + 2] || '',
              instructions: row[baseIndex + 3] || ''
            });
          }
        }
        
        // Parse fast songs (columns Y-AR, indices 24-43)
        for (let j = 0; j < 5; j++) {
          const baseIndex = 24 + (j * 4);
          if (row[baseIndex] && row[baseIndex].toString().trim() !== '') {
            schedule.fastSongs.push({
              title: row[baseIndex],
              link: row[baseIndex + 1],
              lyrics: row[baseIndex + 2] || '',
              instructions: row[baseIndex + 3] || ''
            });
          }
        }
        
        userSchedules.push(schedule);
      }
    }
    
    return createResponse(true, 'Schedules retrieved successfully', {
      schedules: userSchedules
    });
  } catch (error) {
    Logger.log('Get user schedules error: ' + error.toString());
    return createResponse(false, 'Error retrieving schedules: ' + error.toString());
  }
}

function parseScheduleRow(row) {
  const schedule = {
    timestamp: row[0],
    scheduleId: row[1],
    songLeader: row[2],
    scheduleDay: row[3],
    status: row[44] || STATUS.FOR_APPROVAL,
    slowSongs: [],
    fastSongs: []
  };
  
  // Parse slow songs (columns E-X, indices 4-23)
  for (let i = 0; i < 5; i++) {
    const baseIndex = 4 + (i * 4);
    if (row[baseIndex] && row[baseIndex].toString().trim() !== '') {
      schedule.slowSongs.push({
        title: row[baseIndex],
        link: row[baseIndex + 1],
        lyrics: row[baseIndex + 2] || '',
        instructions: row[baseIndex + 3] || ''
      });
    }
  }
  
  // Parse fast songs (columns Y-AR, indices 24-43)
  for (let i = 0; i < 5; i++) {
    const baseIndex = 24 + (i * 4);
    if (row[baseIndex] && row[baseIndex].toString().trim() !== '') {
      schedule.fastSongs.push({
        title: row[baseIndex],
        link: row[baseIndex + 1],
        lyrics: row[baseIndex + 2] || '',
        instructions: row[baseIndex + 3] || ''
      });
    }
  }
  
  return schedule;
}

function getSchedules() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const songSheet = ss.getSheetByName(SHEET_NAMES.PRAISE_WORSHIP);
    
    if (!songSheet) {
      return { success: false, message: 'Praise & Worship Song sheet not found' };
    }
    
    const dataRange = songSheet.getDataRange();
    const values = dataRange.getValues();
    const schedules = [];
    
    // Start from row 3 (index 2) since data starts at row 3
    for (let i = 2; i < values.length; i++) {
      const row = values[i];
      if (row[1] && row[1].toString().trim() !== '') {
        schedules.push(parseScheduleRow(row));
      }
    }
    
    return { success: true, schedules: schedules };
  } catch (error) {
    Logger.log('Get schedules error: ' + error.toString());
    return { success: false, message: 'Error retrieving schedules: ' + error.toString() };
  }
}

function getScheduleByDate(date) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const songSheet = ss.getSheetByName(SHEET_NAMES.PRAISE_WORSHIP);
    
    if (!songSheet) {
      return { success: false, message: 'Praise & Worship Song sheet not found' };
    }
    
    const dataRange = songSheet.getDataRange();
    const values = dataRange.getValues();
    
    // Start from row 3 (index 2) since data starts at row 3
    for (let i = 2; i < values.length; i++) {
      const row = values[i];
      if (row[3] === date) {
        return {
          success: true,
          schedule: parseScheduleRow(row)
        };
      }
    }
    
    return { success: false, message: 'No schedule found for this date' };
  } catch (error) {
    Logger.log('Get schedule by date error: ' + error.toString());
    return { success: false, message: 'Error retrieving schedule: ' + error.toString() };
  }
}

function getScheduleById(id) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const songSheet = ss.getSheetByName(SHEET_NAMES.PRAISE_WORSHIP);
    
    if (!songSheet) {
      return { success: false, message: 'Praise & Worship Song sheet not found' };
    }
    
    const dataRange = songSheet.getDataRange();
    const values = dataRange.getValues();
    
    // Start from row 3 (index 2) since data starts at row 3
    for (let i = 2; i < values.length; i++) {
      const row = values[i];
      if (row[1] === id) {
        return {
          success: true,
          schedule: parseScheduleRow(row)
        };
      }
    }
    
    return { success: false, message: 'Schedule not found' };
  } catch (error) {
    Logger.log('Get schedule by ID error: ' + error.toString());
    return { success: false, message: 'Error retrieving schedule: ' + error.toString() };
  }
}

function checkSchedule(date) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const songSheet = ss.getSheetByName(SHEET_NAMES.PRAISE_WORSHIP);
    
    if (!songSheet) {
      return { success: false, message: 'Praise & Worship Song sheet not found' };
    }
    
    const dataRange = songSheet.getDataRange();
    const values = dataRange.getValues();
    
    // Start from row 3 (index 2) since data starts at row 3
    for (let i = 2; i < values.length; i++) {
      const row = values[i];
      if (row[3] === date) {
        return { success: true, exists: true };
      }
    }
    
    return { success: true, exists: false };
  } catch (error) {
    Logger.log('Check schedule error: ' + error.toString());
    return { success: false, message: 'Error checking schedule: ' + error.toString() };
  }
}

function deleteSchedule(id) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const songSheet = ss.getSheetByName(SHEET_NAMES.PRAISE_WORSHIP);
    
    if (!songSheet) {
      return { success: false, message: 'Praise & Worship Song sheet not found' };
    }
    
    const dataRange = songSheet.getDataRange();
    const values = dataRange.getValues();
    
    // Start from row 3 (index 2) since data starts at row 3
    for (let i = 2; i < values.length; i++) {
      if (values[i][1] === id) {
        songSheet.deleteRow(i + 1);
        return { success: true, message: 'Schedule deleted successfully' };
      }
    }
    
    return { success: false, message: 'Schedule not found' };
  } catch (error) {
    Logger.log('Delete schedule error: ' + error.toString());
    return { success: false, message: 'Error deleting schedule: ' + error.toString() };
  }
}


//utilitiess.js
// Password hashing function using SHA-256
function hashPassword(password) {
  if (password === null || password === undefined) {
    throw new Error('hashPassword called with null or undefined password');
  }
  password = String(password);

  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  var hash = '';
  for (var i = 0; i < digest.length; i++) {
    var byte = digest[i];
    if (byte < 0) byte += 256;
    var b = byte.toString(16);
    if (b.length == 1) b = '0' + b;
    hash += b;
  }
  return hash;
}

function generateMemberId() {
  const min = 100000;
  const max = 999999;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateScheduleId() {
  const min = 10000000;
  const max = 99999999;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getManilaTime() {
  const date = new Date();
  const manilaTime = new Date(date.toLocaleString("en-US", {timeZone: "Asia/Manila"}));
  return manilaTime;
}

function createResponse(success, message, data = null) {
  const response = {
    success: success,
    message: message
  };
  
  if (data) {
    response.data = data;
  }
  
  return response;
}


//admin.js
function verifyUser(username) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const accountsSheet = ss.getSheetByName(SHEET_NAMES.ACCOUNTS);
    
    if (!accountsSheet) {
      return { success: false, message: 'Accounts sheet not found' };
    }
    
    const dataRange = accountsSheet.getDataRange();
    const values = dataRange.getValues();
    
    for (var i = 1; i < values.length; i++) {
      if (values[i][6] === username) {
        accountsSheet.getRange(i + 1, 11).setValue(STATUS.VERIFIED);
        return { success: true, message: 'User verified successfully' };
      }
    }
    
    return { success: false, message: 'User not found' };
  } catch (error) {
    Logger.log('Verify user error: ' + error.toString());
    return { success: false, message: 'Error verifying user: ' + error.toString() };
  }
}

function getUnverifiedUsers() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const accountsSheet = ss.getSheetByName(SHEET_NAMES.ACCOUNTS);
    
    if (!accountsSheet) {
      return [];
    }
    
    const dataRange = accountsSheet.getDataRange();
    const values = dataRange.getValues();
    const unverifiedUsers = [];
    
    for (var i = 1; i < values.length; i++) {
      const row = values[i];
      const status = row[10] || STATUS.UNVERIFIED;
      
      if (status === STATUS.UNVERIFIED) {
        unverifiedUsers.push({
          memberId: row[1],
          firstname: row[2],
          lastname: row[3],
          ministry: row[5],
          username: row[6],
          timestamp: row[0]
        });
      }
    }
    
    return unverifiedUsers;
  } catch (error) {
    Logger.log('Get unverified users error: ' + error.toString());
    return [];
  }
}
