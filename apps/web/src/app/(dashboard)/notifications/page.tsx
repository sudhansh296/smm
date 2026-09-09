"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { Bell, CheckCheck } from "lucide-react";

export default function NotificationsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get("/user/notifications").then((r) => r.data),
    staleTime: 30_000,
    placeholderData: (prev: any) => prev,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/user/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Notifications</h1>
        <p className="text-muted-foreground text-sm mt-0.5">System alerts and order updates</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Bell className="h-4 w-4" />Recent Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && !data ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : !data?.notifications?.length ? (
            <div className="text-center py-10 text-muted-foreground">
              <Bell className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No notifications yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {data.notifications.map((n: { id: string; message: string; isRead: boolean; createdAt: string }) => (
                <div key={n.id} className={`flex items-start gap-3 p-3 sm:p-4 transition-colors ${n.isRead ? "bg-background" : "bg-primary/5"}`}>
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.isRead ? "bg-transparent" : "bg-primary"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{n.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{formatDate(n.createdAt)}</p>
                  </div>
                  {!n.isRead && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className="text-xs">New</Badge>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                        onClick={() => markReadMutation.mutate(n.id)}>
                        <CheckCheck className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
