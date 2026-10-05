"use client";
import { useTransition } from "react";
import { deleteAlertAction } from "../actions";
export function DeleteAlertButton({ id, keyword }: { id: string; keyword: string }) {
  const [pending, start] = useTransition();
  return <button disabled={pending} onClick={() => { if (window.confirm(`Delete the alert “${keyword}” and its history?`)) start(() => deleteAlertAction(id)); }} className="text-xs text-muted underline hover:text-red-500">Delete alert</button>;
}
