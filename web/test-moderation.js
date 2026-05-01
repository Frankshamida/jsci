// Quick test file for content moderation
// Usage: node test-moderation.js

const { detectInappropriateWords } = require('./src/lib/contentModeration');

// Test cases
const testCases = [
  // Safe messages
  { msg: 'Hello, how are you today?', expected: false, label: 'Safe greeting' },
  { msg: 'Let\'s meet up tomorrow!', expected: false, label: 'Safe plan' },
  
  // Inappropriate English
  { msg: 'This is shit', expected: true, label: 'English profanity' },
  { msg: 'You are such a bastard', expected: true, label: 'English insult' },
  
  // Self-harm content
  { msg: 'I want to die', expected: true, label: 'Self-harm ideation' },
  { msg: 'I am suicidal', expected: true, label: 'Suicide mention' },
  
  // Gen Z harmful slang
  { msg: 'kys', expected: true, label: 'Gen Z harm slang' },
  { msg: 'kms i hate this', expected: true, label: 'Multiple harmful terms' },
  
  // Tagalog harmful
  { msg: 'putang ina mo', expected: true, label: 'Tagalog profanity' },
  { msg: 'kamatayan sa lahat', expected: true, label: 'Tagalog death mention' },
];

console.log('🧪 Content Moderation Test Suite\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

testCases.forEach(({ msg, expected, label }) => {
  const result = detectInappropriateWords(msg);
  const isCorrect = result.isInappropriate === expected;
  
  if (isCorrect) {
    console.log(`✅ ${label}`);
    console.log(`   Message: "${msg}"`);
    console.log(`   Result: ${result.isInappropriate ? 'BLOCKED (' + result.matches.join(', ') + ')' : 'SAFE'}`);
    passed++;
  } else {
    console.log(`❌ ${label}`);
    console.log(`   Message: "${msg}"`);
    console.log(`   Expected: ${expected ? 'BLOCKED' : 'SAFE'}`);
    console.log(`   Got: ${result.isInappropriate ? 'BLOCKED (' + result.matches.join(', ') + ')' : 'SAFE'}`);
    failed++;
  }
  console.log();
});

console.log('='.repeat(60));
console.log(`📊 Results: ${passed} passed, ${failed} failed`);
console.log(`Success rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
