import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { CURRENCIES } from '@/lib/currency';
import { z } from 'zod';

const VALID_CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [string, ...string[]];

const patchSchema = z.object({
  currency: z.enum(VALID_CURRENCY_CODES as [string, ...string[]]).optional(),
});

export async function GET() {
  const authz = await requireAuth();
  if (authz instanceof NextResponse) return authz;

  const org = await prisma.organization.findUnique({
    where: { id: authz.organizationId },
    select: { name: true, plan: true, billingPeriod: true, currency: true },
  });

  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(org);
}

export async function PATCH(req: NextRequest) {
  const authz = await requireAuth(['OWNER', 'ADMIN']);
  if (authz instanceof NextResponse) return authz;

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const updated = await prisma.organization.update({
    where: { id: authz.organizationId },
    data: parsed.data,
    select: { currency: true },
  });

  return NextResponse.json(updated);
}
