import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { useAuth } from "../useAuth";
import { getMyProfileServer, updateMyProfileServer, requestAvatarUploadUrlServer } from "./social-profile";
import type { UserProfile, UpdateProfileInput } from "./social-types";

interface ProfileContextType {
  profile: UserProfile | null;
  isLoading: boolean;
  error: string | null;
  refreshProfile: () => Promise<UserProfile | null>;
  updateProfile: (input: UpdateProfileInput) => Promise<UserProfile>;
  uploadAvatar: (file: File) => Promise<UserProfile>;
}

const ProfileContext = createContext<ProfileContextType | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProfile = useCallback(async (): Promise<UserProfile | null> => {
    if (!isLoggedIn) {
      setProfile(null);
      setIsLoading(false);
      return null;
    }
    try {
      setIsLoading(true);
      setError(null);
      const data = await getMyProfileServer();
      setProfile(data);
      return data;
    } catch (err: any) {
      const msg = err?.message || "Không thể tải thông tin hồ sơ";
      console.warn("[Duckroom Social] Failed to fetch profile:", err);
      setError(msg);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (authLoading) return;
    if (!isLoggedIn) {
      setProfile(null);
      setIsLoading(false);
      return;
    }
    void refreshProfile();
  }, [isLoggedIn, authLoading, refreshProfile]);

  const updateProfile = useCallback(async (input: UpdateProfileInput): Promise<UserProfile> => {
    const updated = await updateMyProfileServer({ data: input });
    setProfile(updated);
    return updated;
  }, []);

  const uploadAvatar = useCallback(async (file: File): Promise<UserProfile> => {
    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Kích thước ảnh đại diện không được vượt quá 5MB.");
    }

    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      throw new Error("Vui lòng chọn ảnh định dạng JPG, PNG hoặc WebP.");
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || (file.type === "image/png" ? "png" : "jpg");

    // 1. Get presigned upload URL
    const { uploadUrl, storageKey } = await requestAvatarUploadUrlServer({
      data: {
        fileExtension: ext,
        contentType: file.type,
      },
    });

    // 2. Direct PUT upload to S3
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
      },
      body: file,
    });

    if (!uploadRes.ok) {
      throw new Error(`Upload ảnh lên kho lưu trữ thất bại (Mã lỗi ${uploadRes.status}).`);
    }

    // 3. Update profile with new avatar storage key
    const updated = await updateMyProfileServer({
      data: {
        avatarStorageKey: storageKey,
      },
    });

    setProfile(updated);
    return updated;
  }, []);

  return (
    <ProfileContext.Provider
      value={{
        profile,
        isLoading,
        error,
        refreshProfile,
        updateProfile,
        uploadAvatar,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useSocialProfile() {
  const context = useContext(ProfileContext);
  if (!context) {
    return {
      profile: null,
      isLoading: false,
      error: null,
      refreshProfile: async () => null,
      updateProfile: async () => {
        throw new Error("ProfileProvider is not mounted");
      },
      uploadAvatar: async () => {
        throw new Error("ProfileProvider is not mounted");
      },
    };
  }
  return context;
}
