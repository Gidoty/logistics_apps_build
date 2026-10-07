"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { markMessagesRead, postOrderMessage } from "@/lib/orders/actions";
import { formatDateTime } from "@/lib/orders/format";
import { cn } from "@/lib/utils";

type Message = { id: string; body: string; created_at: string; is_admin: boolean; read_at: string | null };

type Props = {
  orderId: string;
  messages: Message[];
  /** True when an admin is looking: their own messages are the admin ones. */
  viewerIsAdmin: boolean;
};

/** The conversation between buyer and admin about one order. Messages cannot be edited or deleted. */
export function MessageThread({ orderId, messages, viewerIsAdmin }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasUnread = messages.some(
    (message) => message.is_admin !== viewerIsAdmin && message.read_at === null,
  );
  useEffect(() => {
    if (hasUnread) void markMessagesRead(orderId);
  }, [hasUnread, orderId]);

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await postOrderMessage(orderId, body);
      if (!result.ok) return setError(result.message);
      setBody("");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3">
      {messages.length === 0 ? (
        <p className="text-muted-foreground text-sm">No messages yet.</p>
      ) : (
        <ul className="grid gap-2">
          {messages.map((message) => {
            const mine = message.is_admin === viewerIsAdmin;
            return (
              <li key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                    mine ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
                  )}
                >
                  <p className="break-words whitespace-pre-wrap">{message.body}</p>
                  <p
                    className={cn(
                      "mt-1 text-xs",
                      mine ? "text-primary-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    {message.is_admin ? "Support" : "Buyer"}, {formatDateTime(message.created_at)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={send} className="grid gap-2">
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <Label htmlFor="message-body">Write a message</Label>
        <Textarea
          id="message-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={1000}
          rows={3}
        />
        <div>
          <Button type="submit" disabled={pending || body.trim() === ""}>
            {pending ? "Sending..." : "Send message"}
          </Button>
        </div>
      </form>
    </div>
  );
}
