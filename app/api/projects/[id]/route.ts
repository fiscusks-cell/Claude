import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/authz';
import { z } from 'zod';

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  clientId: z.string().nullable().optional(),
  color: z.string().optional(),
  icon: z.string().nullable().optional(),
  hourlyRate: z.number().min(0).optional(),
  isBillable: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authz = await requireAuth(['OWNER', 'ADMIN']);
    if (authz instanceof NextResponse) return authz;
    const { organizationId } = authz;
    const { id } = await params;

    const project = await prisma.project.findFirst({ where: { id, organizationId } });
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    // Validate clientId if provided
    if (parsed.data.clientId) {
      const client = await prisma.client.findFirst({
        where: { id: parsed.data.clientId, organizationId },
      });
      if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const updated = await prisma.project.update({
      where: { id },
      data: parsed.data,
      include: {
        client: { select: { id: true, name: true, currency: true } },
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error('[projects PATCH] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authz = await requireAuth(['OWNER', 'ADMIN']);
    if (authz instanceof NextResponse) return authz;
    const { organizationId } = authz;
    const { id } = await params;

    const project = await prisma.project.findFirst({ where: { id, organizationId } });
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Archive instead of hard delete to preserve time entry history
    await prisma.project.update({ where: { id }, data: { isArchived: true } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[projects DELETE] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
