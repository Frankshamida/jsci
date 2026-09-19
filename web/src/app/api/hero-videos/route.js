// The clips sitting in /public/Videos, for the admin's two dropdowns.
//
// `force-static` is the whole trick here. Files under /public are copied to the
// CDN and are NOT on disk next to a serverless function at runtime, so reading
// the folder when a request arrives works on a laptop and returns nothing once
// deployed. A static route handler is instead evaluated during the build, where
// the whole repository is present, and the answer is then served as a plain
// file. Adding a video therefore means committing it and deploying - which is
// already true of anything under /public.

import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { HERO_VIDEO_DIR, isSafeVideoName } from '@/lib/heroMedia';

export const dynamic = 'force-static';

export function GET() {
  let videos = [];
  try {
    const dir = path.join(process.cwd(), 'public', HERO_VIDEO_DIR);
    videos = fs.readdirSync(dir)
      .filter(isSafeVideoName)
      .map((name) => {
        let bytes = 0;
        try {
          bytes = fs.statSync(path.join(dir, name)).size;
        } catch { /* listed but unreadable - report it with no size */ }
        return { name, bytes };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    // No folder at all is a perfectly good answer: the site has no videos, and
    // the admin form says so instead of breaking the build.
    videos = [];
  }

  return NextResponse.json({ success: true, data: videos });
}
