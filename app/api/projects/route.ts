import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  clientId: z.string().optional(),
  color: z.string().default('#3730A3'),
  icon: z.string().min(1),
  hourlyRate: z.number().min(0).default(0),
  isBillable: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const organizationId = (session.user as { organizationId: string }).organizationId;

    const { searchParams } = new URL(req.url);
    const includeArchived = searchParams.get('includeArchived') === 'true';

    const projects = await prisma.project.findMany({
      where: {
        organizationId,
        ...(!includeArchived ? { isArchived: false } : {}),
      },
      include: {
        client: { select: { id: true, name: true, currency: true } },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(projects);
  } catch (err) {
    console.error('[projects GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const organizationId = (session.user as { organizationId: string }).organizationId;

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { name, description, clientId, color, icon, hourlyRate, isBillable } = parsed.data;

    if (clientId) {
      const client = await prisma.client.findFirst({
        where: { id: clientId, organizationId },
      });
      if (!client) {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 });
      }
    }

    const project = await prisma.project.create({
      data: {
        organizationId,
        name,
        description: description ?? null,
        clientId: clientId ?? null,
        color,
        icon: icon ?? null,
        hourlyRate,
        isBillable,
      },
      include: {
        client: { select: { id: true, name: true, currency: true } },
      },
    });

    return NextResponse.json(project, { status: 201 });
  } catch (err) {
    console.error('[projects POST] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
