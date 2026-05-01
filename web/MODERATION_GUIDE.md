# Content Moderation System

## Overview

This is a comprehensive content moderation system for the private messenger feature that detects and blocks/corrects inappropriate messages in multiple languages (English, Tagalog, Bisaya) and Gen Z slang, with special focus on self-harm and emotionally harmful content.

## Features

### 1. **Multi-Language Support**

- **English**: Profanity and abusive language (bastard, asshole, etc.)
- **Tagalog**: Profanity in Filipino/Tagalog (putang ina, gago, etc.)
- **Bisaya**: Profanity in Cebuano/Bisaya (yawa, buang, etc.)
- **Gen Z Slang**: Harmful internet slang and abbreviations (kys, kms, ctb, etc.)
- **Emotional Harm**: Self-harm ideation, suicide mentions (kill myself, suicidal, etc.)

### 2. **Moderation Modes**

- **Hard Block**: Message is completely blocked and user is notified
- **Auto-Correct**: Message is suggested for correction, user can approve or edit
- **AI Analysis**: Uses Groq API for sentiment analysis and intent detection

### 3. **User Experience**

- Clear modal dialogs explaining why a message was blocked
- Suggested corrections for misspelled/minor offensive words
- User can edit and resubmit or accept AI suggestion
- Helpful messaging about community safety

## Architecture

### Files

**`src/lib/contentModeration.js`** - Core moderation library

- `detectInappropriateWords(content)` - Fast local word-list check
- `analyzeMessageSafety(content)` - AI-powered sentiment analysis via Groq
- `moderateMessage(content)` - Combined check (word-list + AI)

**`src/app/dashboard/page.js`** - Frontend integration

- `handleSendMessage()` - Checks content before sending
- `handleSendCorrectedMessage()` - Sends user-approved or AI-suggested correction
- `handleRejectCorrectedMessage()` - User edits original message
- Moderation Modal UI - Shows blocking reason or correction suggestion

## Usage

### 1. Sending a Message

```javascript
// User types in chat input and clicks Send
// Automatically runs: handleSendMessage()

// If message is safe → sends immediately
// If message has issues → shows modal with reason/suggestion
```

### 2. Blocked Message Example

```
Message: "I want to kill myself"
Result: 🚫 Message Blocked

Reason: "This message contains concerning language about self-harm.
If you're struggling, please reach out to a counselor or crisis hotline. ❤️"

User Action: Close modal only (cannot send)
```

### 3. Suggested Correction Example

```
Message: "U r so stupid btw"
Suggested: "You are so foolish by the way"

User Actions:
- "Edit Message" - Go back and edit
- "Send Corrected" - Accept suggestion and send
```

## Configuration

### Environment Variables

```
NEXT_PUBLIC_GROQ_API_KEY=your_groq_api_key
```

The system uses Groq's Llama 3 8B model for AI analysis. Request API access at https://console.groq.com

### Word Lists

Customize inappropriate words in `src/lib/contentModeration.js`:

```javascript
const INAPPROPRIATE_WORDS = {
  english: ["word1", "word2"],
  tagalog: ["salita1", "salita2"],
  // ... etc
};
```

### Thresholds

Currently uses:

- **Exact word matching** for fast detection
- **Groq API** for semantic analysis (optional, can be extended)
- **No score threshold** - any match triggers review

## Technical Details

### Word Matching Algorithm

- Case-insensitive matching
- Word boundary detection (regex with `\b`)
- Supports partial matching (e.g., f\*\*k → fuck)
- Handles multiple languages simultaneously

### AI Analysis

- Uses Groq API (`meta-llama/llama-3-8b-instruct`)
- System prompt instructs model to check for:
  - Profanity/abuse
  - Self-harm/suicide ideation
  - Harassment/bullying
  - Emotionally harmful intent
- Temperature: 0.3 (low creativity, high consistency)
- Max tokens: 100 (brief responses)

### Fail-Open Design

If moderation fails for any reason:

- System logs the error
- Message is allowed to send (UX-first)
- No disruption to user experience

## API Integration

### Groq API Call

```javascript
POST https://api.groq.com/openai/v1/chat/completions
Headers:
  Authorization: Bearer {GROQ_API_KEY}
  Content-Type: application/json

Body:
{
  model: "meta-llama/llama-3-8b-instruct",
  messages: [
    { role: "system", content: "Check for harmful content..." },
    { role: "user", content: "Check this message..." }
  ],
  temperature: 0.3,
  max_tokens: 100
}
```

## Extensibility

### Add New Language

```javascript
const INAPPROPRIATE_WORDS = {
  // ... existing
  spanish: ["palabra1", "palabra2"],
};
```

### Add Custom Word List

```javascript
const INAPPROPRIATE_WORDS = {
  custom: ["term1", "term2"],
};
```

### Modify Blocking Logic

Edit `moderateMessage()` to change behavior:

- Remove AI check for speed
- Add logging for audit trail
- Add severity levels
- Add user muting system

## Testing

Run the test file:

```bash
node test-moderation.js
```

Expected output shows test results for safe/blocked messages.

## Future Enhancements

1. **Audit Logging**
   - Store blocked messages in database
   - Track user violations
   - Admin dashboard to review

2. **User Warnings**
   - Warning system for repeat offenders
   - Muting/suspension for abuse

3. **Machine Learning**
   - Train model on community-specific language
   - Improve detection accuracy over time

4. **Context Awareness**
   - Different rules for different channels
   - Whitelist certain terms in specific contexts

5. **Language Detection**
   - Auto-detect language and apply appropriate rules
   - Support more languages

6. **Performance**
   - Cache AI responses
   - Rate limit AI calls
   - Batch moderation for bulk operations

## Monitoring & Debugging

### Enable Debug Logging

Add to `handleSendMessage()`:

```javascript
console.log("Moderation Result:", modResult);
```

### Check Groq API Status

```javascript
// Verify API key is set
console.log(
  "Groq API Key:",
  process.env.NEXT_PUBLIC_GROQ_API_KEY ? "Set" : "Not Set",
);
```

### Common Issues

**Issue**: Messages always blocked

- Check word list for overly broad terms
- Verify regex is correct
- Lower strictness if needed

**Issue**: Moderation slow

- Disable AI check (comment out `analyzeMessageSafety()`)
- Use local word-list only
- Implement caching

**Issue**: Groq API errors

- Verify API key is correct
- Check rate limits
- Verify network connectivity

## Community Guidelines

Share this with users to explain moderation:

> **Our Commitment to Safety**
>
> We use AI and keyword filtering to protect our community from:
>
> - Profanity and abusive language
> - Self-harm ideation or suicide mentions
> - Harassment and bullying
> - Emotionally harmful content
>
> If you're struggling with your mental health, please reach out:
>
> - National Suicide Prevention Lifeline: 1-800-273-8255
> - Crisis Text Line: Text HOME to 741741
> - International Association for Suicide Prevention: https://www.iasp.info/resources/Crisis_Centres/

## Support

For questions or issues with the moderation system:

1. Check error logs in browser console
2. Review Groq API documentation
3. Test with `test-moderation.js`
4. Verify environment variables are set
