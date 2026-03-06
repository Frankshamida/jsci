import { NextResponse } from 'next/server';

const GROQ_API_KEY = process.env.NEXT_PUBLIC_GROQ_API_KEY || '';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// GET - Fetch song lyrics using Groq AI with YouTube context for accuracy
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const title = searchParams.get('title');
    const link = searchParams.get('link') || '';

    if (!title) {
      return NextResponse.json({ success: false, message: 'Song title is required' }, { status: 400 });
    }

    if (!GROQ_API_KEY) {
      return NextResponse.json({ success: false, message: 'AI service not configured' }, { status: 500 });
    }

    // Step 1: If a YouTube link is provided, fetch video metadata from noembed for extra context
    let ytVideoTitle = '';
    let ytChannel = '';
    if (link) {
      const ytMatch = link.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (ytMatch) {
        try {
          const oembedRes = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${ytMatch[1]}`);
          const oembedData = await oembedRes.json();
          ytVideoTitle = oembedData.title || '';
          ytChannel = oembedData.author_name || '';
        } catch { /* silent — proceed without YouTube context */ }
      }
    }

    // Step 2: Parse song name and artist from the title field (format: "SONG TITLE - ARTIST")
    let songName = title;
    let artist = '';
    if (title.includes(' - ')) {
      const parts = title.split(' - ');
      songName = parts[0].trim();
      artist = parts[1].trim();
    }

    // Step 3: Build a rich context message for Groq AI
    let userMessage = `I need the EXACT and COMPLETE lyrics for this song:\n\n`;
    userMessage += `Song Title: "${songName}"\n`;
    if (artist) userMessage += `Artist: "${artist}"\n`;
    if (ytVideoTitle) userMessage += `YouTube Video Title: "${ytVideoTitle}"\n`;
    if (ytChannel) userMessage += `YouTube Channel: "${ytChannel}"\n`;
    userMessage += `\nPlease output the full lyrics for this exact song.`;

    // Step 4: Call Groq AI with maximum context
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'system',
            content: `You are a professional lyrics database with encyclopedic knowledge of song lyrics. Your ONLY job is to output the EXACT, COMPLETE, ACCURATE lyrics of the song the user requests.

CRITICAL IDENTIFICATION RULES:
- The user provides a Song Title and possibly an Artist name, YouTube video title, and YouTube channel.
- Use ALL of these clues together to identify the EXACT correct song. Do not confuse songs with similar titles by different artists.
- The YouTube video title and channel are the MOST RELIABLE clues for identifying which specific song and version the user wants.
- If the artist or YouTube channel is a worship band (Hillsong, Planetshakers, Bethel Music, Elevation Worship, etc.), make sure you output the lyrics for THAT specific version/recording.

OUTPUT RULES:
1. Output ONLY the lyrics — absolutely NO introductions, explanations, commentary, or notes. Start directly with the first section label or first lyric line.
2. Include ALL verses, choruses, bridges, pre-choruses, and outros in the correct order as they appear in the official studio recording.
3. Label each section on its own line in square brackets: [Verse 1], [Chorus], [Verse 2], [Pre-Chorus], [Bridge], [Outro], etc.
4. Preserve the original line breaks exactly as they are sung.
5. If the song has repeated choruses, write them out in full each time — do NOT use shortcuts like "(Repeat Chorus)" or "(x2)".
6. Use the standard/official lyrics. If the song has parts in other languages, include those parts in their original language.
7. Do NOT add guitar chords, timestamps, or any annotations.
8. Do NOT add any text before or after the lyrics. No "Here are the lyrics" preamble.
9. Output your best known version — never refuse or say you don't know.
10. Be as ACCURATE as possible. Every word matters for worship.`
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        temperature: 0.05,
        max_tokens: 4000,
      }),
    });

    const data = await res.json();
    let lyrics = data?.choices?.[0]?.message?.content?.trim();

    if (!lyrics) {
      return NextResponse.json({
        success: true,
        data: null,
        message: 'Could not generate lyrics for this song',
      });
    }

    // Clean up any preamble the AI might have added despite instructions
    // Remove lines like "Here are the lyrics..." before the first section bracket or first lyric
    const firstBracket = lyrics.indexOf('[');
    if (firstBracket > 0 && firstBracket < 150) {
      const before = lyrics.substring(0, firstBracket).trim();
      // If text before first bracket looks like a preamble (no line breaks = single line intro), remove it
      if (!before.includes('\n') || before.length < 100) {
        lyrics = lyrics.substring(firstBracket);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        title: songName,
        artist: artist || ytChannel || '',
        lyrics,
      },
    });
  } catch (error) {
    console.error('Lyrics AI error:', error);
    return NextResponse.json({ success: false, message: 'Failed to fetch lyrics: ' + error.message }, { status: 500 });
  }
}
