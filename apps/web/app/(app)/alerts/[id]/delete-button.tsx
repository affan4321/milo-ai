"use client";
import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteAlertAction } from "../actions";
export function DeleteAlertButton({ id, keyword }: { id: string; keyword: string }) {
  const [pending, start] = useTransition();
  return <button disabled={pending} onClick={() => { if (window.confirm(`Delete the alert “${keyword}” and its history?`)) start(() => deleteAlertAction(id)); }} className="btn btn-ghost btn-danger btn-sm"><Trash2 />Delete alert</button>;
}
