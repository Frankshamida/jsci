import { NextResponse } from 'next/server';
import { getCloudinaryConfig } from '@/lib/cloudinary';
import { cached } from '@/lib/serverCache';

export const dynamic = 'force-dynamic';

// Cloudinary's Admin API is limited to ~500 calls/hour on the free plan, and usage
// figures only move slowly. Serve every caller from one cached read so N open admin
// tabs cost a single upstream call per window instead of N.
const USAGE_TTL_MS = 5 * 60 * 1000;

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function fetchUsage() {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/usage`;
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

  const res = await fetch(endpoint, {
    headers: { Authorization: `Basic ${auth}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    const err = new Error(`Cloudinary usage request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }

  const usage = await res.json();

  return {
    storageBytes: safeNumber(usage?.storage?.usage || usage?.storage_usage || usage?.storage?.usage_bytes),
    bandwidthBytes: safeNumber(usage?.bandwidth?.usage || usage?.bandwidth_usage || usage?.bandwidth?.usage_bytes),
    transformations: safeNumber(usage?.transformations?.usage || usage?.transformations_usage),
    raw: {
      storage: usage?.storage || null,
      bandwidth: usage?.bandwidth || null,
      transformations: usage?.transformations || null,
    },
  };
}

export async function GET() {
  try {
    const data = await cached('cloudinary:usage', USAGE_TTL_MS, fetchUsage);
    return NextResponse.json({ success: true, data }, {
      status: 200,
      headers: { 'Cache-Control': 'private, max-age=60' },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || 'Unexpected error' },
      { status: error.status || 500 }
    );
  }
}
