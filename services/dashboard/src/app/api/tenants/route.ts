import { NextResponse } from "next/server";
import { getAuthUid } from "@/lib/auth-server";
import { getPool } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const uid = await getAuthUid();
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, persona_prompt } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    
    if (!persona_prompt || typeof persona_prompt !== "string" || persona_prompt.trim().length === 0) {
      return NextResponse.json({ error: "Persona prompt is required" }, { status: 400 });
    }

    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO tenants (name, persona_prompt, owner_uid)
       VALUES ($1, $2, $3)
       RETURNING id, name, created_at`,
      [name.trim(), persona_prompt.trim(), uid]
    );

    return NextResponse.json(res.rows[0]);
  } catch (err: any) {
    console.error("Failed to create tenant:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
