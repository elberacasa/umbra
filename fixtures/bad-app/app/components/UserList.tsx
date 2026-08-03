'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { formatCurrency } from '../../lib/helpers.js';
import { slugify } from '../../lib/utils.js';

const supabase = createClient(
  'https://demo.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!,
);

interface User {
  id: string;
  name: string;
  bio: string;
  balance: number;
}

export default function UserList() {
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    void supabase
      .from('users')
      .select('*')
      .then(({ data }) => setUsers((data as User[]) ?? []));
  }, []);

  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>
          <h2>{slugify(user.name)}</h2>
          <div dangerouslySetInnerHTML={{ __html: user.bio }} />
          <span>{formatCurrency(user.balance)}</span>
        </li>
      ))}
    </ul>
  );
}
