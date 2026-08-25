import { createContext, useContext, type ReactNode } from "react";
import { useAuth } from "./useAuth";
import { useMemberLibrary } from "./useMemberLibrary";

type MemberLibraryContextValue = ReturnType<typeof useMemberLibrary>;
const MemberLibraryContext = createContext<MemberLibraryContextValue | null>(null);

export function MemberLibraryProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuth();
  const value = useMemberLibrary(isLoggedIn);
  return <MemberLibraryContext.Provider value={value}>{children}</MemberLibraryContext.Provider>;
}

export function useMemberLibraryContext() {
  const value = useContext(MemberLibraryContext);
  if (!value) throw new Error("useMemberLibraryContext must be used inside MemberLibraryProvider");
  return value;
}
