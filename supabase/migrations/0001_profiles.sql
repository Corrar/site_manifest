-- Perfis de jogador. Escrita só pelo nosso servidor (service role).
-- RLS ligado e sem políticas: anon/authenticated não leem nem escrevem.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nick text not null check (char_length(nick) between 2 and 20),
  nick_key text not null unique,
  team smallint not null check (team >= 0),
  look smallint not null default 0 check (look >= 0),
  birth_date date,
  role text not null default 'player' check (role in ('player', 'staff')),
  banned_until timestamptz,
  team_changed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
