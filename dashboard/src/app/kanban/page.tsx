"use client";

import { useEffect, useState, useCallback } from "react";

interface KanbanTicket {
  id: string;
  title: string;
  description: string | null;
  column: string;
  position: number;
  priority: string;
  assignee: string | null;
  labels: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

const COLUMNS = ["backlog", "todo", "in-progress", "review", "done"];
const COLUMN_LABELS: Record<string, string> = {
  "backlog": "Backlog",
  "todo": "To Do",
  "in-progress": "In Progress",
  "review": "Review",
  "done": "Done",
};
const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-500",
  medium: "bg-blue-500",
  high: "bg-orange-500",
  urgent: "bg-red-500",
};

export default function KanbanPage() {
  const [tickets, setTickets] = useState<KanbanTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedTicket, setDraggedTicket] = useState<KanbanTicket | null>(null);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [newTicket, setNewTicket] = useState({ title: "", column: "backlog", priority: "medium" });
  const [editingTicket, setEditingTicket] = useState<KanbanTicket | null>(null);

  const loadTickets = useCallback(async () => {
    try {
      const res = await fetch("/api/kanban");
      const data = await res.json();
      setTickets(data.tickets || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const handleCreate = async () => {
    if (!newTicket.title.trim()) return;
    try {
      const res = await fetch("/api/kanban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newTicket),
      });
      if (res.ok) {
        setNewTicket({ title: "", column: "backlog", priority: "medium" });
        setShowNewTicket(false);
        loadTickets();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdate = async (ticket: KanbanTicket) => {
    try {
      await fetch(`/api/kanban/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ticket),
      });
      setEditingTicket(null);
      loadTickets();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/kanban/${id}`, { method: "DELETE" });
      loadTickets();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDragStart = (ticket: KanbanTicket) => {
    setDraggedTicket(ticket);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (column: string) => {
    if (!draggedTicket) return;
    try {
      await fetch(`/api/kanban/${draggedTicket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column }),
      });
      setDraggedTicket(null);
      loadTickets();
    } catch (err) {
      console.error(err);
    }
  };

  const getTicketsByColumn = (column: string) =>
    tickets.filter((t) => t.column === column).sort((a, b) => a.position - b.position);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900 text-white">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-slate-100">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
        <h1 className="text-lg font-semibold">Kanban Board</h1>
        <button
          type="button"
          onClick={() => setShowNewTicket(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
        >
          + New Ticket
        </button>
      </div>

      {showNewTicket && (
        <div className="p-4 bg-slate-800 border-b border-slate-700">
          <div className="flex gap-2">
            <input
              type="text"
              value={newTicket.title}
              onChange={(e) => setNewTicket({ ...newTicket, title: e.target.value })}
              placeholder="Ticket title..."
              className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm"
            />
            <select
              value={newTicket.column}
              onChange={(e) => setNewTicket({ ...newTicket, column: e.target.value })}
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm"
            >
              {COLUMNS.map((col) => (
                <option key={col} value={col}>{COLUMN_LABELS[col]}</option>
              ))}
            </select>
            <select
              value={newTicket.priority}
              onChange={(e) => setNewTicket({ ...newTicket, priority: e.target.value })}
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <button
              type="button"
              onClick={handleCreate}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowNewTicket(false)}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
        {COLUMNS.map((column) => (
          <div
            key={column}
            className="flex-shrink-0 w-72 flex flex-col bg-slate-800 rounded"
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(column)}
          >
            <div className="px-3 py-2 border-b border-slate-700 flex items-center justify-between">
              <span className="font-medium text-sm">{COLUMN_LABELS[column]}</span>
              <span className="text-xs text-slate-400">{getTicketsByColumn(column).length}</span>
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-y-auto">
              {getTicketsByColumn(column).map((ticket) => (
                <div
                  key={ticket.id}
                  draggable
                  onDragStart={() => handleDragStart(ticket)}
                  className="bg-slate-700 rounded p-3 cursor-grab hover:bg-slate-600 transition-colors"
                >
                  {editingTicket?.id === ticket.id ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editingTicket.title}
                        onChange={(e) => setEditingTicket({ ...editingTicket, title: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-sm"
                      />
                      <textarea
                        value={editingTicket.description || ""}
                        onChange={(e) => setEditingTicket({ ...editingTicket, description: e.target.value })}
                        placeholder="Description..."
                        className="w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-sm resize-none"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <select
                          value={editingTicket.priority}
                          onChange={(e) => setEditingTicket({ ...editingTicket, priority: e.target.value })}
                          className="px-2 py-1 bg-slate-600 border border-slate-500 rounded text-xs"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => handleUpdate(editingTicket)}
                          className="px-2 py-1 bg-green-600 hover:bg-green-500 rounded text-xs"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTicket(null)}
                          className="px-2 py-1 bg-slate-600 hover:bg-slate-500 rounded text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-2">
                        <span className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${PRIORITY_COLORS[ticket.priority] || PRIORITY_COLORS.medium}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{ticket.title}</div>
                          {ticket.description && (
                            <div className="text-xs text-slate-400 mt-1 line-clamp-2">{ticket.description}</div>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            {ticket.assignee && (
                              <span className="text-xs bg-slate-600 px-1.5 py-0.5 rounded">{ticket.assignee}</span>
                            )}
                            {ticket.labels && (
                              <span className="text-xs bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">
                                {ticket.labels}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1 mt-2 pt-2 border-t border-slate-600">
                        <button
                          type="button"
                          onClick={() => setEditingTicket(ticket)}
                          className="text-xs text-slate-400 hover:text-white"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(ticket.id)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}