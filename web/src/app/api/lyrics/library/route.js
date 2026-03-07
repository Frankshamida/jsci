import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const GROQ_API_KEY = process.env.NEXT_PUBLIC_GROQ_API_KEY || '';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Religious words auto-capitalization map (English, Tagalog, Bisaya)
const SACRED_WORDS = {
  'god': 'God', 'jesus': 'Jesus', 'christ': 'Christ', 'lord': 'Lord',
  'holy spirit': 'Holy Spirit', 'holy': 'Holy', 'spirit': 'Spirit',
  'father': 'Father', 'savior': 'Savior', 'saviour': 'Saviour',
  'king': 'King', 'messiah': 'Messiah', 'almighty': 'Almighty',
  'redeemer': 'Redeemer', 'creator': 'Creator', 'lamb': 'Lamb',
  // Tagalog
  'ama': 'Ama', 'anak': 'Anak', 'diyos': 'Diyos', 'panginoon': 'Panginoon',
  'hesus': 'Hesus', 'kristo': 'Kristo', 'espiritu santo': 'Espiritu Santo',
  'espiritu': 'Espiritu', 'tagapagligtas': 'Tagapagligtas', 'hari': 'Hari',
  'manlilikha': 'Manlilikha', 'makapangyarihan': 'Makapangyarihan',
  // Bisaya / Cebuano
  'ginoo': 'Ginoo', 'amahan': 'Amahan', 'anak nga lalaki': 'Anak nga Lalaki',
  'balaang espiritu': 'Balaang Espiritu', 'balaang': 'Balaang',
  'manluluwas': 'Manluluwas', 'magbubuhat': 'Magbubuhat',
  'makagagahum': 'Makagagahum', 'hesukristo': 'HesuKristo',
};

// Apply sacred word capitalization to text
function capitalizeSacredWords(text) {
  if (!text) return text;
  let result = text;
  // Sort by length descending so multi-word phrases are matched first
  const sortedWords = Object.keys(SACRED_WORDS).sort((a, b) => b.length - a.length);
  for (const word of sortedWords) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    result = result.replace(regex, SACRED_WORDS[word]);
  }
  return result;
}

// Auto-format pasted lyrics into sections
function autoFormatLyrics(rawText) {
  if (!rawText) return { sections: [], html: '', plain: '' };

  const lines = rawText.split('\n');
  const sections = [];
  let currentSection = { label: 'Intro', content: '' };
  let sectionIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect section headers like [Verse 1], [Chorus], (Bridge), etc.
    const sectionMatch = trimmed.match(/^\[?\(?(Verse\s*\d*|Chorus|Pre[-\s]?Chorus|Bridge|Outro|Intro|Interlude|Hook|Tag|Refrain|Ending|Verse)\)?\]?\s*:?\s*$/i);
    if (sectionMatch) {
      // Save current section if it has content
      if (currentSection.content.trim()) {
        currentSection.content = capitalizeSacredWords(currentSection.content.trim());
        sections.push({ ...currentSection });
      }
      currentSection = { label: sectionMatch[1].trim(), content: '' };
      sectionIndex++;
      continue;
    }

    // Check for inline section markers like "Verse 1:" at the start of a line
    const inlineMatch = trimmed.match(/^(Verse\s*\d*|Chorus|Pre[-\s]?Chorus|Bridge|Outro|Intro|Interlude|Hook|Tag|Refrain|Ending)\s*:\s*(.*)$/i);
    if (inlineMatch) {
      if (currentSection.content.trim()) {
        currentSection.content = capitalizeSacredWords(currentSection.content.trim());
        sections.push({ ...currentSection });
      }
      currentSection = { label: inlineMatch[1].trim(), content: inlineMatch[2] ? inlineMatch[2] + '\n' : '' };
      sectionIndex++;
      continue;
    }

    currentSection.content += line + '\n';
  }

  // Push last section
  if (currentSection.content.trim()) {
    currentSection.content = capitalizeSacredWords(currentSection.content.trim());
    sections.push(currentSection);
  }

  // If no sections were detected, treat the whole text as one section
  if (sections.length === 0 && rawText.trim()) {
    sections.push({ label: 'Verse 1', content: capitalizeSacredWords(rawText.trim()) });
  }

  // Build HTML and plain text
  let html = '';
  let plain = '';
  for (const sec of sections) {
    html += `<div class="lyrics-section"><div class="lyrics-section-label">${sec.label}</div><div class="lyrics-section-content">${sec.content.replace(/\n/g, '<br>')}</div></div>`;
    plain += `[${sec.label}]\n${sec.content}\n\n`;
  }

  return { sections, html, plain: plain.trim() };
}

// GET - Fetch lyrics from library
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const search = searchParams.get('search');
    const language = searchParams.get('language');
    const status = searchParams.get('status');
    const scheduleDate = searchParams.get('scheduleDate');

    // Fetch single lyrics by ID
    if (id) {
      const { data, error } = await supabase.from('lyrics_library').select('*').eq('id', id).single();
      if (error) throw error;
      return NextResponse.json({ success: true, data });
    }

    // Fetch lyrics linked to a specific schedule date
    if (scheduleDate) {
      const { data, error } = await supabase.from('lyrics_library')
        .select('*')
        .contains('linked_schedule_dates', [scheduleDate])
        .order('title', { ascending: true });
      if (error) throw error;
      return NextResponse.json({ success: true, data: data || [] });
    }

    // Fetch all with optional filters
    let query = supabase.from('lyrics_library').select('*').order('updated_at', { ascending: false });
    if (language && language !== 'All') query = query.eq('language', language);
    if (status && status !== 'All') query = query.eq('status', status);
    if (search) {
      query = query.or(`title.ilike.%${search}%,artist.ilike.%${search}%,lyrics_plain.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Create new lyrics OR AI auto-fill from YouTube
export async function POST(request) {
  try {
    const body = await request.json();
    const { action } = body;

    // AI Auto-fill: Detect title, artist, language from YouTube link
    if (action === 'ai-autofill') {
      const { youtubeLink } = body;
      if (!youtubeLink) return NextResponse.json({ success: false, message: 'YouTube link required' }, { status: 400 });
      if (!GROQ_API_KEY) return NextResponse.json({ success: false, message: 'AI service not configured' }, { status: 500 });

      // Extract YouTube video metadata
      let ytVideoTitle = '';
      let ytChannel = '';
      const ytMatch = youtubeLink.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (ytMatch) {
        try {
          const oembedRes = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${ytMatch[1]}`);
          const oembedData = await oembedRes.json();
          ytVideoTitle = oembedData.title || '';
          ytChannel = oembedData.author_name || '';
        } catch { /* silent */ }
      }

      // Use AI to extract structured info
      const aiRes = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            {
              role: 'system',
              content: `You are a music metadata expert. Given a YouTube video title and channel name, extract the song information and return ONLY valid JSON with these exact fields:
{
  "title": "Song Title (clean, no extra info)",
  "artist": "Artist/Band Name",
  "language": "English" or "Tagalog" or "Bisaya" or "Mixed",
  "lyrics": "Full lyrics with section labels like [Verse 1], [Chorus], [Bridge], etc."
}

Rules:
- For language detection: If the song is primarily in Cebuano/Bisaya, use "Bisaya". If Filipino/Tagalog, use "Tagalog". If English, use "English". If mixed languages, use "Mixed".
- Clean the title: remove "(Official Music Video)", "(Lyric Video)", "(Live)", channel names, etc.
- For lyrics: Include ALL verses, choruses, bridges in order. Label each section. Write them out fully (no repeats shorthand).
- Capitalize sacred/religious words properly: God, Jesus, Christ, Lord, Holy Spirit, Ama, Ginoo, Diyos, Panginoon, etc.
- Return ONLY the JSON, no other text.`
            },
            {
              role: 'user',
              content: `YouTube Video Title: "${ytVideoTitle}"\nYouTube Channel: "${ytChannel}"\nYouTube Link: "${youtubeLink}"`
            }
          ],
          temperature: 0.1,
          max_tokens: 4000,
        }),
      });

      const aiData = await aiRes.json();
      let aiContent = aiData?.choices?.[0]?.message?.content?.trim() || '';

      // Parse JSON from AI response
      try {
        // Extract JSON if wrapped in markdown code block
        const jsonMatch = aiContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) aiContent = jsonMatch[1].trim();

        const parsed = JSON.parse(aiContent);
        // Auto-format the lyrics into sections
        const formatted = autoFormatLyrics(parsed.lyrics || '');

        return NextResponse.json({
          success: true,
          data: {
            title: parsed.title || ytVideoTitle || '',
            artist: parsed.artist || ytChannel || '',
            language: parsed.language || 'English',
            lyrics_plain: formatted.plain,
            lyrics_html: formatted.html,
            sections: formatted.sections,
          }
        });
      } catch {
        return NextResponse.json({
          success: true,
          data: {
            title: ytVideoTitle || '',
            artist: ytChannel || '',
            language: 'English',
            lyrics_plain: '',
            lyrics_html: '',
            sections: [],
          }
        });
      }
    }

    // AI Format: Format pasted lyrics text into sections
    if (action === 'ai-format') {
      const { rawLyrics, title } = body;
      if (!rawLyrics) return NextResponse.json({ success: false, message: 'Lyrics text required' }, { status: 400 });

      // If lyrics already have section labels, just format them
      if (/\[(Verse|Chorus|Bridge|Pre-Chorus|Outro|Intro)/i.test(rawLyrics)) {
        const formatted = autoFormatLyrics(rawLyrics);
        return NextResponse.json({ success: true, data: { sections: formatted.sections, lyrics_html: formatted.html, lyrics_plain: formatted.plain } });
      }

      // Use AI to add section labels
      if (!GROQ_API_KEY) {
        // Fallback: just auto-format without AI
        const formatted = autoFormatLyrics(rawLyrics);
        return NextResponse.json({ success: true, data: { sections: formatted.sections, lyrics_html: formatted.html, lyrics_plain: formatted.plain } });
      }

      const aiRes = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            {
              role: 'system',
              content: `You are a lyrics formatting expert. Given raw song lyrics, add proper section labels and return the formatted lyrics.

Rules:
1. Add section labels like [Verse 1], [Verse 2], [Chorus], [Pre-Chorus], [Bridge], [Outro], [Intro] on their own line before each section.
2. Identify repeated sections as [Chorus] or the same label.
3. Keep the original lyrics text EXACTLY as given, only add section labels.
4. Capitalize sacred/religious words: God, Jesus, Christ, Lord, Holy Spirit, Ama, Ginoo, Diyos, Panginoon, Amahan, HesuKristo, etc.
5. Preserve original line breaks.
6. Return ONLY the formatted lyrics with section labels, no other text.`
            },
            {
              role: 'user',
              content: `${title ? `Song: "${title}"\n\n` : ''}Lyrics:\n${rawLyrics}`
            }
          ],
          temperature: 0.05,
          max_tokens: 4000,
        }),
      });

      const aiData = await aiRes.json();
      const aiLyrics = aiData?.choices?.[0]?.message?.content?.trim() || rawLyrics;
      const formatted = autoFormatLyrics(aiLyrics);
      return NextResponse.json({ success: true, data: { sections: formatted.sections, lyrics_html: formatted.html, lyrics_plain: formatted.plain } });
    }

    // Regular save: Create new lyrics entry
    const { title, artist, language, youtube_link, lyrics_html, lyrics_plain, sections, prepared_by, prepared_by_name, status: lyricsStatus } = body;

    if (!title) return NextResponse.json({ success: false, message: 'Song title is required' }, { status: 400 });

    // Apply sacred word capitalization to plain text
    const capitalizedPlain = capitalizeSacredWords(lyrics_plain || '');
    const capitalizedHtml = capitalizeSacredWords(lyrics_html || '');
    const capitalizedSections = (sections || []).map(s => ({
      ...s,
      content: capitalizeSacredWords(s.content || ''),
    }));

    const { data, error } = await supabase.from('lyrics_library').insert({
      title,
      artist: artist || null,
      language: language || 'English',
      youtube_link: youtube_link || null,
      lyrics_html: capitalizedHtml,
      lyrics_plain: capitalizedPlain,
      sections: capitalizedSections,
      prepared_by: prepared_by || null,
      prepared_by_name: prepared_by_name || null,
      status: lyricsStatus || 'Published',
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Lyrics saved successfully!' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update lyrics entry or link to schedule
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, action: putAction } = body;

    if (!id) return NextResponse.json({ success: false, message: 'Lyrics ID required' }, { status: 400 });

    // Link/unlink lyrics to a schedule date
    if (putAction === 'link-schedule') {
      const { scheduleDate, songTitle } = body;
      const { data: existing } = await supabase.from('lyrics_library').select('linked_schedule_dates').eq('id', id).single();
      const dates = existing?.linked_schedule_dates || [];
      if (!dates.includes(scheduleDate)) {
        dates.push(scheduleDate);
      }
      await supabase.from('lyrics_library').update({ linked_schedule_dates: dates }).eq('id', id);
      return NextResponse.json({ success: true, message: `Lyrics linked to ${scheduleDate}` });
    }

    if (putAction === 'unlink-schedule') {
      const { scheduleDate } = body;
      const { data: existing } = await supabase.from('lyrics_library').select('linked_schedule_dates').eq('id', id).single();
      const dates = (existing?.linked_schedule_dates || []).filter(d => d !== scheduleDate);
      await supabase.from('lyrics_library').update({ linked_schedule_dates: dates }).eq('id', id);
      return NextResponse.json({ success: true, message: `Lyrics unlinked from ${scheduleDate}` });
    }

    // Regular update
    const { title, artist, language, youtube_link, lyrics_html, lyrics_plain, sections, status: lyricsStatus } = body;
    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (artist !== undefined) updateData.artist = artist;
    if (language !== undefined) updateData.language = language;
    if (youtube_link !== undefined) updateData.youtube_link = youtube_link;
    if (lyrics_html !== undefined) updateData.lyrics_html = capitalizeSacredWords(lyrics_html);
    if (lyrics_plain !== undefined) updateData.lyrics_plain = capitalizeSacredWords(lyrics_plain);
    if (sections !== undefined) updateData.sections = (sections || []).map(s => ({ ...s, content: capitalizeSacredWords(s.content || '') }));
    if (lyricsStatus !== undefined) updateData.status = lyricsStatus;

    const { data, error } = await supabase.from('lyrics_library').update(updateData).eq('id', id).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Lyrics updated!' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Remove lyrics
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

    const { error } = await supabase.from('lyrics_library').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true, message: 'Lyrics deleted.' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
