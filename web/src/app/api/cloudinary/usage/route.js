import { NextResponse } from 'next/server';
import { getCloudinaryConfig } from '@/lib/cloudinary';

export const dynamic = 'force-dynamic';

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function GET() {
  try {
    const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
    const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/usage`;
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

    const res = await fetch(endpoint, {
      headers: { Authorization: `Basic ${auth}` },
      // Keep usage reasonably fresh but avoid hammering the API when cached by the platform
      next: { revalidate: 30 },
    });

    if (!res.ok) {
      const msg = `Cloudinary usage request failed (${res.status})`;
      return NextResponse.json({ success: false, message: msg }, { status: res.status });
    }

    const usage = await res.json();

    const storageBytes = safeNumber(usage?.storage?.usage || usage?.storage_usage || usage?.storage?.usage_bytes);
    const bandwidthBytes = safeNumber(usage?.bandwidth?.usage || usage?.bandwidth_usage || usage?.bandwidth?.usage_bytes);
    const transformations = safeNumber(usage?.transformations?.usage || usage?.transformations_usage);

    return NextResponse.json({
      success: true,
      data: {
        storageBytes,
        bandwidthBytes,
        transformations,
        raw: {
          storage: usage?.storage || null,
          bandwidth: usage?.bandwidth || null,
          transformations: usage?.transformations || null,
        },
      },
    }, {
      status: 200,
      headers: { 'Cache-Control': 'private, max-age=15' },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message || 'Unexpected error' }, { status: 500 });
  }
}
