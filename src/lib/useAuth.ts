import { useEffect, useState } from "react";
import { supabase } from "./supabase-client";
import type { Session, User } from "@supabase/supabase-js";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return {
    session,
    user: isMounted ? user : null,
    isLoggedIn: isMounted && !!session?.user,
    isLoading: !isMounted || isLoading,
    accessToken: session?.access_token ?? null,
    signOut,
  };
}

export async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch (err) {
    console.error("Error getting access token:", err);
    return null;
  }
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
