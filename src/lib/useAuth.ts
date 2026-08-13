import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type AuthUser = {
  id: string;
  email: string;
  isAdmin?: boolean;
};

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) {
        setUser({
          id: session.user.id,
          email: session.user.email,
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.email) {
        setUser({
          id: session.user.id,
          email: session.user.email,
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signInWithOtp = async (email: string) => {
    return await supabase.auth.signInWithOtp({ email });
  };

  const signOut = async () => {
    return await supabase.auth.signOut();
  };

  return {
    user,
    loading,
    signInWithOtp,
    signOut,
  };
}

/**
 * Returns authorization headers containing current Supabase session token if available
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return {
        Authorization: `Bearer ${session.access_token}`,
      };
    }
  } catch (err) {
    console.warn("Error reading Supabase auth headers:", err);
  }
  return {};
}
