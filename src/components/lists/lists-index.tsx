"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { List, Plus, Trash2, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface StoreList {
  id: string;
  name: string;
  description: string | null;
  storeCount: number;
  createdAt: string;
  updatedAt: string;
}

export function ListsIndex() {
  const { t } = useI18n();
  const [lists, setLists] = useState<StoreList[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchLists = useCallback(async () => {
    try {
      const res = await fetch("/api/lists");
      if (res.ok) {
        const data = await res.json();
        setLists(data.lists ?? []);
      }
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
      });
      if (res.ok) {
        const list = await res.json();
        setLists((prev) => [list, ...prev]);
        setNewName("");
        setNewDesc("");
        setCreateOpen(false);
      }
    } catch {
      // silently handle
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("lists.deleteConfirm"))) return;
    try {
      await fetch(`/api/lists/${id}`, { method: "DELETE" });
      setLists((prev) => prev.filter((l) => l.id !== id));
    } catch {
      // silently handle
    }
  };

  return (
    <main className="h-[calc(100vh)] overflow-y-auto px-5 py-5">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-xl font-bold">{t("lists.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("lists.subtitle")}
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t("lists.create")}
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* Empty state */}
      {!loading && lists.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/10">
            <List className="h-8 w-8 text-primary" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground max-w-md">
            {t("lists.empty")}
          </p>
          <Button className="mt-4" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t("lists.create")}
          </Button>
        </div>
      )}

      {/* Lists grid */}
      {!loading && lists.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((list) => (
            <div
              key={list.id}
              className="group relative rounded-xl border border-border/50 bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <Link href={`/lists/${list.id}`} className="block">
                <h3 className="font-medium truncate">{list.name}</h3>
                {list.description && (
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {list.description}
                  </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  {list.storeCount} {t("lists.stores")}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(list.id)}
                className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("lists.createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">{t("lists.name")}</label>
              <Input
                placeholder={t("lists.namePlaceholder")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t("lists.description")}</label>
              <Input
                placeholder=""
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t("lists.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
