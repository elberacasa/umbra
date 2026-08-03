alter table public.users enable row level security;

create policy "users can read their own row"
  on public.users
  for select
  using (auth.uid() = id);
