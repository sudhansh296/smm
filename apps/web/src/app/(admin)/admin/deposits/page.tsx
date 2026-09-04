"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { CheckCircle, XCircle, X } from "lucide-react";

const STATUS_COLORS: Record<string,string> = { PENDING:"bg-yellow-100 text-yellow-800", COMPLETED:"bg-green-100 text-green-800", FAILED:"bg-red-100 text-red-800" };
const METHOD_COLORS: Record<string,string> = { RAZORPAY:"bg-blue-100 text-blue-800", MANUAL_INR:"bg-indigo-100 text-indigo-800", cryptomus:"bg-purple-100 text-purple-800", MANUAL_USDT:"bg-orange-100 text-orange-800" };
const METHOD_LABELS: Record<string,string> = { RAZORPAY:"Razorpay", MANUAL_INR:"Manual INR", cryptomus:"Cryptomus", MANUAL_USDT:"Manual USDT", AUTO:"Auto" };

export default function AdminDepositsPage() {
  const [status, setStatus] = useState("PENDING");
  const [method, setMethod] = useState("ALL");
  const [page, setPage] = useState(1);
  const [approveD, setApproveD] = useState<any>(null);
  const [rejectD, setRejectD] = useState<any>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-deposits", status, method, page],
    queryFn: () => api.get("/admin/deposits", { params: { status: status==="ALL"?undefined:status, method: method==="ALL"?undefined:method, page, limit:20 } }).then(r=>r.data),
    placeholderData:(prev)=>prev, refetchInterval:30_000,
  });

  const approve = useMutation({
    mutationFn:({id,note}:{id:string,note:string})=>api.post(`/admin/deposits/${id}/approve`,{note}).then(r=>r.data),
    onSuccess:(d)=>{ toast.success(d.message); setApproveD(null); setNote(""); qc.invalidateQueries({queryKey:["admin-deposits"]}); },
    onError:(err)=>toast.error(getErrorMessage(err)),
  });
  const reject = useMutation({
    mutationFn:({id,reason}:{id:string,reason:string})=>api.post(`/admin/deposits/${id}/reject`,{reason}).then(r=>r.data),
    onSuccess:()=>{ toast.success("Rejected"); setRejectD(null); setReason(""); qc.invalidateQueries({queryKey:["admin-deposits"]}); },
    onError:(err)=>toast.error(getErrorMessage(err)),
  });

  return (
    <div className="space-y-5">
      {approveD && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-xl border shadow-xl w-full max-w-md p-5 space-y-4">
            <div className="flex justify-between"><h2 className="font-semibold">Approve Deposit</h2><button onClick={()=>setApproveD(null)}><X className="h-4 w-4"/></button></div>
            <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
              <p><span className="text-muted-foreground">User:</span> {approveD.userEmail}</p>
              <p><span className="text-muted-foreground">Method:</span> {METHOD_LABELS[approveD.method]??approveD.method}</p>
              {approveD.amountInr&&<p><span className="text-muted-foreground">Amount:</span> Rs.{approveD.amountInr}</p>}
              {approveD.amountUsdt&&<p><span className="text-muted-foreground">Amount:</span> ${approveD.amountUsdt} USDT</p>}
              {approveD.txId&&<p><span className="text-muted-foreground">TxID:</span> <span className="font-mono text-xs">{approveD.txId}</span></p>}
            </div>
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800">Will credit user wallet. Cannot be undone.</div>
            <div className="space-y-1.5"><label className="text-xs font-medium">Note (optional)</label><Input value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. Verified on bank portal"/></div>
            <div className="flex gap-2">
              <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={()=>approve.mutate({id:approveD.id,note})} disabled={approve.isPending}>{approve.isPending?"Processing...":"Approve & Credit"}</Button>
              <Button variant="outline" className="flex-1" onClick={()=>setApproveD(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
      {rejectD && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-xl border shadow-xl w-full max-w-md p-5 space-y-4">
            <div className="flex justify-between"><h2 className="font-semibold">Reject Deposit</h2><button onClick={()=>setRejectD(null)}><X className="h-4 w-4"/></button></div>
            <div className="rounded-lg bg-muted p-3 text-sm"><p><span className="text-muted-foreground">User:</span> {rejectD.userEmail}</p>{rejectD.txId&&<p><span className="text-muted-foreground">TxID:</span> <span className="font-mono text-xs">{rejectD.txId}</span></p>}</div>
            <div className="space-y-1.5"><label className="text-xs font-medium">Reason *</label><Input value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. UTR not found"/></div>
            <div className="flex gap-2">
              <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white" onClick={()=>reject.mutate({id:rejectD.id,reason})} disabled={reject.isPending||!reason.trim()}>{reject.isPending?"Processing...":"Reject"}</Button>
              <Button variant="outline" className="flex-1" onClick={()=>setRejectD(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div><h1 className="text-2xl sm:text-3xl font-bold">Deposits</h1>{data?.pendingCount>0&&<p className="text-yellow-600 font-medium text-sm">{data.pendingCount} pending approval</p>}</div>
        <div className="flex gap-2">
          <Select value={status} onValueChange={v=>{setStatus(v);setPage(1);}}><SelectTrigger className="w-32"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="ALL">All</SelectItem><SelectItem value="PENDING">Pending</SelectItem><SelectItem value="COMPLETED">Approved</SelectItem><SelectItem value="FAILED">Rejected</SelectItem></SelectContent></Select>
          <Select value={method} onValueChange={v=>{setMethod(v);setPage(1);}}><SelectTrigger className="w-36"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="ALL">All Methods</SelectItem><SelectItem value="RAZORPAY">Razorpay</SelectItem><SelectItem value="MANUAL_INR">Manual INR</SelectItem><SelectItem value="cryptomus">Cryptomus</SelectItem><SelectItem value="MANUAL_USDT">Manual USDT</SelectItem></SelectContent></Select>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:hidden">
        {isLoading?<p className="text-center py-8 text-muted-foreground text-sm">Loading...</p>:!data?.deposits?.length?<p className="text-center py-8 text-muted-foreground text-sm">No deposits</p>:data.deposits.map((d:any)=>(
          <Card key={d.id}><CardContent className="p-4 space-y-2">
            <div className="flex justify-between gap-2"><div><p className="font-medium text-sm">{d.userEmail}</p><p className="text-xs text-muted-foreground">{formatDate(d.createdAt)}</p></div><Badge className={"text-xs "+STATUS_COLORS[d.status]}>{d.status}</Badge></div>
            <div className="flex gap-2 text-xs flex-wrap"><Badge className={"text-xs "+(METHOD_COLORS[d.method]??"bg-gray-100 text-gray-800")}>{METHOD_LABELS[d.method]??d.method}</Badge>{d.amountInr&&<span>Rs.{d.amountInr}</span>}{d.amountUsdt&&<span>${d.amountUsdt} USDT</span>}</div>
            {d.txId&&<p className="text-xs font-mono text-muted-foreground truncate">TxID: {d.txId}</p>}
            {d.status==="PENDING"&&<div className="flex gap-2 pt-1"><Button size="sm" className="flex-1 h-8 bg-green-600 hover:bg-green-700 text-white text-xs" onClick={()=>setApproveD(d)}><CheckCircle className="h-3 w-3 mr-1"/>Approve</Button><Button size="sm" variant="outline" className="flex-1 h-8 text-red-600 border-red-200 text-xs" onClick={()=>setRejectD(d)}><XCircle className="h-3 w-3 mr-1"/>Reject</Button></div>}
          </CardContent></Card>
        ))}
      </div>

      <div className="hidden lg:block rounded-lg border overflow-hidden"><table className="w-full text-sm">
        <thead className="bg-muted border-b"><tr><th className="text-left px-4 py-3 font-medium">User</th><th className="text-left px-4 py-3 font-medium">Method</th><th className="text-right px-4 py-3 font-medium">Amount</th><th className="text-left px-4 py-3 font-medium">TxID</th><th className="text-left px-4 py-3 font-medium">Note</th><th className="text-center px-4 py-3 font-medium">Status</th><th className="text-left px-4 py-3 font-medium">Date</th><th className="px-4 py-3">Actions</th></tr></thead>
        <tbody className="divide-y">{isLoading?<tr><td colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</td></tr>:!data?.deposits?.length?<tr><td colSpan={8} className="text-center py-8 text-muted-foreground">No deposits</td></tr>:data.deposits.map((d:any)=>(
          <tr key={d.id} className="hover:bg-muted/30">
            <td className="px-4 py-3"><p className="font-medium text-sm">{d.userName}</p><p className="text-xs text-muted-foreground">{d.userEmail}</p></td>
            <td className="px-4 py-3"><Badge className={"text-xs "+(METHOD_COLORS[d.method]??"bg-gray-100 text-gray-800")}>{METHOD_LABELS[d.method]??d.method}</Badge></td>
            <td className="px-4 py-3 text-right font-medium">{d.amountInr?`Rs.${d.amountInr}`:`$${d.amountUsdt} USDT`}</td>
            <td className="px-4 py-3 text-xs font-mono truncate max-w-28">{d.txId??"—"}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-24">{d.adminNote??"—"}</td>
            <td className="px-4 py-3 text-center"><Badge className={"text-xs "+STATUS_COLORS[d.status]}>{d.status}</Badge></td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(d.createdAt)}</td>
            <td className="px-4 py-3">{d.status==="PENDING"&&<div className="flex gap-1"><Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white px-2" onClick={()=>setApproveD(d)}><CheckCircle className="h-3 w-3"/></Button><Button size="sm" variant="outline" className="h-7 text-red-600 border-red-200 px-2" onClick={()=>setRejectD(d)}><XCircle className="h-3 w-3"/></Button></div>}{d.status==="COMPLETED"&&<span className="text-xs text-green-600">Approved</span>}{d.status==="FAILED"&&<span className="text-xs text-red-600">Rejected</span>}</td>
          </tr>
        ))}</tbody>
      </table></div>

      {data&&data.totalPages>1&&<div className="flex justify-center gap-2"><Button variant="outline" size="sm" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</Button><span className="px-3 py-2 text-sm text-muted-foreground">{page} / {data.totalPages}</span><Button variant="outline" size="sm" disabled={page===data.totalPages} onClick={()=>setPage(page+1)}>Next</Button></div>}
    </div>
  );
}