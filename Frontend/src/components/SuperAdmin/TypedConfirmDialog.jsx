import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function TypedConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  expectedText,
  inputLabel = "Type confirmation",
  confirmLabel = "Confirm",
  confirmVariant = "default",
  onConfirm,
}) {
  const [typedText, setTypedText] = useState("");

  useEffect(() => {
    if (!open) {
      setTypedText("");
    }
  }, [open]);

  const canConfirm = useMemo(() => typedText.trim() === String(expectedText || ""), [expectedText, typedText]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-slate-500">Required: <strong>{expectedText}</strong></p>
          <Label htmlFor="typed-confirm-input">{inputLabel}</Label>
          <Input id="typed-confirm-input" value={typedText} onChange={(event) => setTypedText(event.target.value)} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={confirmVariant === "destructive" ? "bg-red-600 hover:bg-red-700" : ""}
            disabled={!canConfirm}
            onClick={() => onConfirm?.(typedText.trim())}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
