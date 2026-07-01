import { useEffect, useState } from "react";
import { Loader2, X, MessageSquare, ChevronUp } from "lucide-react";
import { ProfileCard } from "../components/ProfileCard";
import { useProfileViewer, closeProfile } from "../os/profileViewer";
import { profileApi, type PublicProfile, type Post } from "../lib/api";

// ProfileViewer is the full-page profile overlay, opened via openProfile(userId)
// from anywhere (chat/posts/comments). Shows the profile card + recent posts.
export function ProfileViewer() {
  const userId = useProfileViewer();
  if (!userId) return null;
  return <ProfileOverlay userId={userId} />;
}

function ProfileOverlay({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setProfile(null);
    setPosts(null);
    setErr(false);
    profileApi.publicById(userId).then(setProfile).catch(() => setErr(true));
    profileApi.posts(userId).then((r) => setPosts(r.posts ?? [])).catch(() => setPosts([]));
  }, [userId]);

  return (
    <div className="absolute inset-0 z-[9000] flex items-start justify-center overflow-auto bg-black/60 p-6 backdrop-blur-sm" onClick={closeProfile}>
      <div className="my-4 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex justify-end">
          <button onClick={closeProfile} className="rounded-lg bg-white/10 p-1.5 text-white/70 hover:bg-white/15 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {err ? (
          <div className="rounded-2xl border border-white/10 bg-[#0e1016] p-6 text-center text-sm text-white/50">Couldn't load this profile.</div>
        ) : !profile ? (
          <div className="flex h-40 items-center justify-center rounded-2xl border border-white/10 bg-[#0e1016]"><Loader2 className="h-5 w-5 animate-spin text-white/30" /></div>
        ) : (
          <div className="space-y-3">
            <ProfileCard p={profile} />

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">Posts</div>
              {posts === null ? (
                <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-white/30" /></div>
              ) : posts.length === 0 ? (
                <p className="py-2 text-[11px] text-white/35">No posts yet.</p>
              ) : (
                <div className="space-y-2">
                  {posts.map((p) => (
                    <div key={p.id} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                      <div className="mb-0.5 flex items-center gap-2 text-[10px] text-white/40">
                        <span className="rounded-full bg-white/10 px-1.5 py-0.5 uppercase tracking-wide">{p.category}</span>
                        <span>{new Date(p.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="text-sm font-semibold text-white">{p.title}</div>
                      {p.body && <p className="mt-0.5 line-clamp-2 text-xs text-white/60">{p.body}</p>}
                      <div className="mt-1 flex items-center gap-3 text-[11px] text-white/40">
                        <span className="flex items-center gap-1"><ChevronUp className="h-3 w-3" /> {p.upvotes}</span>
                        <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" /> {p.comment_count ?? 0}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
