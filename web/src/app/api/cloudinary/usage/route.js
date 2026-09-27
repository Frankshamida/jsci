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

  // On the free plan every metric draws from ONE monthly credit allowance
  // (1 credit ~ 1 GB stored, 1 GB delivered, or 1,000 transformations), so
  // each metric is reported with the credits it has used, next to the total.
  return {
    plan: usage?.plan || null,
    lastUpdated: usage?.last_updated || null,
    credits: {
      usage: safeNumber(usage?.credits?.usage),
      limit: safeNumber(usage?.credits?.limit),
      usedPercent: safeNumber(usage?.credits?.used_percent),
    },
    storageBytes: safeNumber(usage?.storage?.usage || usage?.storage_usage || usage?.storage?.usage_bytes),
    storageCredits: safeNumber(usage?.storage?.credits_usage),
    bandwidthBytes: safeNumber(usage?.bandwidth?.usage || usage?.bandwidth_usage || usage?.bandwidth?.usage_bytes),
    bandwidthCredits: safeNumber(usage?.bandwidth?.credits_usage),
    // A COUNT of transformations, not credits.
    transformations: safeNumber(usage?.transformations?.usage || usage?.transformations_usage),
    transformationCredits: safeNumber(usage?.transformations?.credits_usage),
    assets: safeNumber(usage?.resources),
    imageMaxBytes: safeNumber(usage?.media_limits?.image_max_size_bytes),
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
