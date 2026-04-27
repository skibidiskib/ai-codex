'use client';

interface UserCardProps {
  name: string;
  email: string;
  avatar?: string;
}

export default function UserCard({ name, email, avatar }: UserCardProps) {
  return <div>{name} - {email}</div>;
}
