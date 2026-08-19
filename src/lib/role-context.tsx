import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getCurrentRoleServer } from "./role-functions";
import { useAuth } from "./useAuth";

type RoleState = {
  userId: string | null;
  email: string | null;
  role: "member" | "owner" | null;
  loading: boolean;
};

const RoleContext = createContext<RoleState | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuth();
  const [state, setState] = useState<RoleState>({
    userId: null,
    email: null,
    role: null,
    loading: isLoggedIn,
  });

  useEffect(() => {
    let cancelled = false;
    if (!isLoggedIn) {
      setState({ userId: null, email: null, role: null, loading: false });
      return;
    }
    setState((current) => ({ ...current, loading: true }));
    void getCurrentRoleServer()
      .then((data) => {
        if (!cancelled) setState({ ...data, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState((current) => ({ ...current, role: null, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  return <RoleContext.Provider value={state}>{children}</RoleContext.Provider>;
}

export function useDuckroomRole() {
  const value = useContext(RoleContext);
  if (!value) {
    return {
      userId: null,
      email: null,
      role: null,
      loading: false,
      isOwner: false,
      isMember: false,
    };
  }
  return {
    ...value,
    isOwner: value.role === "owner",
    isMember: value.role === "member",
  };
}
