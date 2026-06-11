import { useMemo } from "react";
import { useSelector } from "react-redux";

export default function usePermission(permission) {
  const permissions = useSelector((state) => state.adminAuth?.permissions || []);
  const permissionSet = useMemo(() => new Set(permissions), [permissions]);
  return permissionSet.has(permission);
}
