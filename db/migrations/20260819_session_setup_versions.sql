-- Ejecutar una vez en el SQL Editor de Supabase antes de desplegar esta versión.
-- Cada fila es un snapshot inmutable: nunca se actualiza ni se deduplica por contenido.

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public)
values ('session-setups', 'session-setups', false)
on conflict (id) do update set public = false;

create table if not exists session_setup_version (
  id uuid primary key default gen_random_uuid(),
  sesion_id uuid not null references sesion(id) on delete cascade,
  piloto_id uuid not null references piloto(id) on delete cascade,
  nombre_archivo text not null,
  storage_path text not null unique,
  tamano_bytes integer not null check (tamano_bytes >= 0),
  modificado_en_origen timestamptz,
  detectado_en timestamptz not null default now(),
  version integer not null,
  unique (sesion_id, version)
);

create index if not exists session_setup_version_sesion_idx
  on session_setup_version (sesion_id, detectado_en desc);

alter table session_setup_version enable row level security;
-- El backend usa SUPABASE_SERVICE_KEY; no se habilitan accesos directos del navegador.
