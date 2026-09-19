# Duckroom Friends — Product + Technical Design Plan

> Status: DESIGN FREEZE / READY FOR IMPLEMENTATION  
> Repository baseline: `TheValkyri/Duckroom` — current `main`  
> Scope: Profile → Friend Graph → Realtime Presence/Listening Activity (L1)  
> Deferred: L2 click-to-play, L3 Listen Along

---

## 0. Executive decision

Duckroom Friends should **not** start as “put Supabase Presence into the player”.

The correct dependency order is:

```text
Identity / Profile
        ↓
Friend Graph + privacy
        ↓
Realtime authorization
        ↓
Presence + listening activity
        ↓
Friends UI
        ↓
L2 / L3 interactions
```

The database remains the canonical source for durable social relationships and profile data.

Realtime remains the transport/state layer for ephemeral presence and current listening activity.

### Final V1 product contract

- Every Member gets a real Duckroom profile.
- Profile supports:
  - avatar
  - display name
  - unique `@handle`
  - friend code
- Users can find another Member using:
  - exact `@handle`
  - exact friend code
- Friend system is a real graph:
  - request
  - accept
  - reject/cancel
  - remove friend
  - block
- V1 shows:
  - online
  - listening
  - paused
  - offline
- Offline UX target: **10 seconds of stale social heartbeat**, not a promise that the underlying WebSocket physically closes exactly at 10.0 seconds.
- Default visibility:
  - presence: friends only
  - listening activity: friends only
  - invisible/ghost mode can hide both
- L2 click-to-play is deferred.
- L3 Listen Along is deferred.
- No per-second Postgres writes.
- No per-second `Presence.track()`.
- Social realtime must remain separate from `player-broadcast.ts`.
- Desktop and mobile must reuse Duckroom's current visual language and mobile sheet primitives.

---

# 1. Current Duckroom constraints we must preserve

## Existing shell

`src/components/AppShell.tsx` currently has:

### Desktop

- collapsible left sidebar:
  - expanded: `256px`
  - collapsed: `80px`
- search entry
- primary navigation
- owner-only entries
- account block at the bottom
- global player remains fixed to the bottom

### Mobile

- fixed glass top header: `56px`
- search button
- theme button
- owner shortcuts
- login/logout
- fixed 5-item bottom navigation
- secondary destinations live in `MobileMoreSheet`

### Existing mobile primitives

`src/components/MobileSheet.tsx` already provides:

- bottom-sheet interaction
- backdrop
- drag-to-dismiss
- Escape close
- scroll lock
- safe-area handling
- focus restoration
- reduced-motion compatibility through the existing root `MotionConfig`

**Decision:** Friends on mobile must use `MobileSheet`, not another bespoke modal/sheet implementation.

---

# 2. Current player architecture we must not disturb

Duckroom already separates:

```text
Player UI
   ↓
player.tsx
   ↓
player-engine.ts
   ↓
audio/network implementation
```

and has:

```text
player-queue.ts
player-broadcast.ts
player-persistence.ts
player-preferences-sync.ts
```

`player-broadcast.ts` is specifically responsible for **multi-tab playback arbitration**.

It must remain that way.

### Do NOT do this

```text
player-broadcast.ts
 ├─ multi-tab leader election
 ├─ friend presence
 ├─ friend status
 └─ social messages
```

### Do this instead

```text
Player Engine
    │
    └──── derives current playback facts
                    │
                    ▼
            Social Presence Adapter
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
       Presence            Broadcast
          │                   │
          └─────────┬─────────┘
                    ▼
              Social Store
                    ▼
                 UI
```

The social layer observes the player. It does not own the player.

---

# 3. Identity / Profile model

## Why profile comes first

Current `public.profiles` has:

- `user_id`
- `email`
- `role`
- `display_name`
- timestamps

It does **not** yet contain:

- avatar
- unique handle
- friend code
- social privacy settings

Current profile RLS also only allows normal users to read their own profile.

Therefore the current profile system is not sufficient for a friend graph.

---

## Proposed durable profile fields

Extend `public.profiles` with:

```sql
handle TEXT NOT NULL UNIQUE
avatar_storage_key TEXT
friend_code TEXT NOT NULL UNIQUE
presence_visibility TEXT NOT NULL DEFAULT 'friends'
listening_visibility TEXT NOT NULL DEFAULT 'friends'
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Recommended checks:

```text
handle:
  - normalized lowercase lookup key
  - unique
  - 3–24 chars
  - letters, numbers, underscore, dot
  - no spaces

friend_code:
  - exact-match only
  - case-insensitive normalization
  - generated server-side
  - never reused while active
```

### Important identity rule

**Email must not be the public friend identifier.**

Email can remain account/private metadata, but friend discovery should use `@handle` or friend code.

---

# 4. Profile UX

## Desktop

The existing bottom-left account block in `AppShell` should evolve from:

```text
[user icon] email
           Owner
                 [logout]
```

into:

```text
[avatar]  Display Name
          @handle
          Owner
                 [logout]
```

The block is clickable to `/profile`.

The logout button remains a separate action so users do not accidentally sign out when opening their profile.

---

## Mobile

Current header is already crowded.

Do **not** keep adding icons indefinitely.

Recommended final mobile shell:

```text
Duckroom    [Search] [Friends] [Theme] [Avatar]
```

Owner-only management shortcuts remain inside `MobileMoreSheet` instead of consuming more permanent header width.

Tapping the avatar opens the existing account/profile surface.

Tapping Friends opens the Friends `MobileSheet`.

This preserves the current 44px-ish touch target convention and keeps the bottom navigation at exactly 5 destinations.

---

# 5. Profile page

Proposed route:

```text
/profile
```

Member profile surface:

```text
┌─────────────────────────────────────┐
│             [ Avatar ]              │
│                                     │
│         Display Name                │
│         @handle                     │
│                                     │
│  Friend code: DUCK-XXXX-XXXX        │
│                              [Copy] │
│                                     │
│  [Chọn ảnh đại diện]                │
│  [Sửa tên hiển thị]                 │
│  [Đổi @handle]                      │
│                                     │
│  Privacy                             │
│  ○ Hiện diện: Bạn bè                │
│  ○ Hoạt động nghe: Bạn bè           │
│  □ Ghost / Ẩn hoạt động             │
└─────────────────────────────────────┘
```

Do not show the user's email here by default.

---

# 6. Avatar storage strategy

Do not store a long-lived public URL in `profiles`.

Store:

```text
avatar_storage_key
```

and resolve it into a short-lived signed URL using the existing S3 utilities.

Presence payloads must **not** contain the avatar URL.

Presence only carries a stable:

```text
userId
```

The client resolves/caches profile metadata separately.

This avoids repeating display name, avatar URL, and other profile metadata in every realtime update.

---

# 7. Friend discovery

## Search surfaces

Dedicated Friends experience:

```text
/friends
```

with:

```text
[Tìm @handle hoặc mã bạn bè...]
```

Examples:

```text
@khacn
DUCK-A7M4-2KQX
```

## Search policy

Do not expose an unrestricted profile directory.

Preferred lookup behavior:

### `@handle`

- normalized
- exact match
- optionally small prefix search later
- max a few results
- rate limited

### friend code

- exact match only
- one result maximum

Returned fields should be minimal:

```text
user_id
display_name
handle
avatar
relationship state
```

Never return:

```text
email
role
private preferences
private library details
```

---

# 8. Friend graph

## Durable states

Use a dedicated table, e.g.:

```text
public.friendships
```

Recommended model:

```text
id
requester_id
addressee_id
status
created_at
updated_at
accepted_at
```

with states:

```text
pending
accepted
rejected
blocked
```

A unique canonical pair must prevent duplicate relationships.

Recommended invariant:

```text
canonical_user_a < canonical_user_b
```

Store the pair only once.

This is much safer than storing A→B and B→A independently.

---

# 9. Friend operations

V1 supports:

```text
send request
accept
reject
cancel outgoing request
remove friend
block
unblock
```

Rules:

- cannot friend yourself
- blocked users cannot create a valid friend relationship
- duplicate pending requests collapse into one deterministic state
- accepting a request atomically changes the relationship to `accepted`
- removing a friend immediately removes the relationship
- blocking removes/invalidates active friendship access
- social realtime subscriptions must react to relationship changes

---

# 10. Privacy model

The safest default is:

```text
Profile discovery:
  handle/code lookup only

Presence:
  friends only

Listening activity:
  friends only

Ghost mode:
  hides presence + listening activity

Email:
  private

Friend code:
  visible on your own profile
```

A user should have two independent controls:

```text
Show me online            [on/off]
Show what I'm listening to [on/off]
```

with Ghost Mode acting as the global override.

### Important

Privacy must be enforced at the Realtime authorization layer.

Client-side filtering alone is not sufficient.

---

# 11. Realtime topology

## Do not use one global “all members” Presence channel

A global channel would make privacy much harder to enforce correctly because presence state is channel-scoped.

The selected architecture is:

```text
Per-user private social topic

social:user:<userId>
```

Each user owns their own activity topic.

Friends subscribe to the topics of people they are actually connected to.

Conceptually:

```text
Alice
  └─ social:user:alice
          ↑
          ├── Bob subscribed
          └── Carol subscribed

Bob
  └─ social:user:bob
          ↑
          ├── Alice subscribed
          └── Dave subscribed
```

This gives:

- friend-scoped delivery
- no global presence leak
- natural privacy boundaries
- easy ownership rule for writes
- easy future extension for activity/status messages

This is the practical meaning of the earlier “C — dedicated social channel” decision: **dedicated social transport, but scoped by user topic rather than one public/global room.**

---

# 12. Presence vs Broadcast

Supabase currently documents Presence as the feature for shared online/user state, while also explicitly warning that Presence is not intended for high-frequency updates. Broadcast is intended for low-latency custom messages and high-frequency-style events.

Therefore:

## Presence

Use for:

```text
initial presence state
join / leave
semantic status changes
current activity snapshot
```

Examples:

```text
online
listening
paused
offline
```

## Broadcast

Use for:

```text
social heartbeat
position refresh
future ephemeral activity events
```

Do not use Postgres writes for any of these live updates.

---

# 13. The 10-second offline decision

This needs one clarification:

**10 seconds should be treated as an application-level stale threshold, not a guarantee that Supabase will detect transport death at exactly 10 seconds.**

The Realtime protocol itself has its own heartbeat behavior, so a pure “Presence leave event = offline within 10 seconds” assumption is unsafe.

Recommended behavior:

```text
social heartbeat interval: ~5s
stale threshold:            10s
```

The peer state machine says:

```text
now - last_social_heartbeat > 10s
    => show Offline
```

When a fresh heartbeat arrives:

```text
Offline → Online/Listening/Paused
```

### Why this is not `Presence.track()` every 5 seconds

Supabase explicitly warns that rapidly calling `track()` can flood a Presence channel.

So the application heartbeat should be a lightweight Broadcast event, while Presence remains the persisted-in-channel state snapshot and semantic status mechanism.

---

# 14. Listening activity model

Do not model listening using only:

```text
startedAt + Date.now()
```

That breaks on:

- pause
- resume
- seek
- track change
- tab suspension
- sleep timer
- replay
- buffering/recovery

Use a position model instead:

```ts
type SocialListeningActivity = {
  type: "listening";
  trackId: string;
  albumId: string | null;

  playing: boolean;

  positionMs: number;
  positionUpdatedAt: number;

  durationMs: number;

  revision: number;
};
```

When `playing === true`, a peer can interpolate:

```text
displayPosition =
  positionMs + (now - positionUpdatedAt)
```

When paused:

```text
displayPosition = positionMs
```

A new exact position is sent on:

```text
track change
play
pause
seek
resume
major playback correction
```

This gives a smooth progress bar without transmitting every animation frame.

---

# 15. Social status state machine

V1 states:

```text
OFFLINE
   ↑
   │ stale > 10s
   │
ONLINE ───────→ LISTENING
  │                │
  │                ├── pause ─→ PAUSED
  │                │
  │                └── next ─→ LISTENING
  │
  └── app closes/network loss
```

More precisely:

```text
ONLINE
  = connected, not currently playing

LISTENING
  = connected + current track + playing

PAUSED
  = connected + current track + paused

OFFLINE
  = no valid social heartbeat for >10s
```

A paused user remains online.

---

# 16. Track visibility and privacy

A friend may be listening to:

- a public track
- a members-only track
- an owner-only/private track
- a track that was later deleted/trashed

Never blindly disclose the track title/album to the friend.

The receiving client/server path must verify that the referenced media can be shown to that recipient.

Display fallback:

```text
Đang nghe một nội dung riêng tư
```

rather than leaking metadata.

If the track is visible:

```text
[cover]
Tên bài
Nghệ sĩ
Album
02:14 ━━━━━━━ 04:01
```

For V1, the activity card is informational only.

No “Play” action yet.

---

# 17. Presence payload size

Keep presence state compact.

Do NOT send:

```text
full Track object
full Album object
lyrics
signed S3 URLs
cover blobs
artist metadata object
```

Send identifiers and playback facts:

```ts
{
  (userId, status, trackId, albumId, playing, positionMs, positionUpdatedAt, durationMs, revision);
}
```

Profile/media data are resolved separately.

---

# 18. Client social architecture

Proposed directory:

```text
src/lib/social/
├── social-types.ts
├── social-store.ts
├── social-profile.ts
├── social-friendships.ts
├── social-presence.ts
├── social-subscriptions.ts
└── index.ts
```

Server-facing logic should remain explicit and separate from browser-only realtime code.

Suggested split:

```text
src/lib/social/
  social-profile.server.ts
  social-friendships.server.ts

src/lib/social/
  social-presence.ts
  social-store.ts
  social-types.ts
```

Do not create another giant `social.ts` file.

Duckroom has already been decomposing large modules; Friends should follow the same discipline from day one.

---

# 19. Server API shape

Recommended operations:

```text
getMyProfile
updateMyProfile

findUsers
getProfile

sendFriendRequest
acceptFriendRequest
rejectFriendRequest
cancelFriendRequest
removeFriend
blockUser
unblockUser

listFriends
listIncomingRequests
listOutgoingRequests
```

Every mutation:

- authenticates the current user
- validates input with Zod
- enforces ownership/relationship invariants
- rate limits discovery-sensitive operations
- returns typed results

Do not let the browser directly mutate friendship rows by bypassing the server domain boundary.

---

# 20. Realtime authorization

Private channels must be enabled.

The Realtime authorization policy should encode:

### Publish Presence/Broadcast

Only the owner of:

```text
social:user:<userId>
```

can publish activity for that topic.

### Receive Presence/Broadcast

The current authenticated user may receive the topic only when:

```text
current_user
is the owner
OR
current_user and topic_owner have an accepted friendship
```

Blocked relationships must fail this check.

The authorization layer is part of the feature, not an optional hardening step.

---

# 21. Friend list UI

## Desktop

Dedicated route:

```text
/friends
```

Recommended layout:

```text
┌──────────────────────────────────────────────────────┐
│ Bạn bè                              [Thêm bạn]       │
│                                                      │
│ [ Tìm @handle hoặc mã bạn bè... ]                    │
│                                                      │
│  Đang hoạt động                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │ [avatar] Khánh                               │    │
│  │ @khacn                                       │    │
│  │ ● Đang nghe                                 │    │
│  │   [cover] Bài hát — Nghệ sĩ                 │    │
│  │   01:42 ━━━━━━━                             │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  Ngoại tuyến                                         │
│  ...                                                 │
└──────────────────────────────────────────────────────┘
```

Use the current Duckroom language:

- `bg-card`
- `glass`
- `glass-strong`
- `bg-accent`
- `text-primary`
- rounded 2xl / 3xl where appropriate
- soft shadows
- subtle borders only where structurally useful
- no decorative permanent separator lines

Do not introduce a visually unrelated Discord clone.

---

# 22. Friend activity card

Recommended visual hierarchy:

```text
[Avatar + status dot]

Display Name
@handle

● Đang nghe
    [cover]  Track title
             Artist · Album

             01:42 ━━━━━━━━━ 04:01
```

For paused:

```text
○ Đang tạm dừng
```

For online without listening:

```text
● Đang online
```

For stale:

```text
○ Offline
```

Use the existing accent theme for activity emphasis.

---

# 23. Mobile Friends UI

Do not create a sixth bottom-nav item.

Mobile entry:

```text
Header → Friends icon
```

opens:

```text
MobileSheet
  title = "Bạn bè"
```

Inside:

```text
[Tìm bạn...]

Đang hoạt động
  friend cards

Ngoại tuyến
  friend cards

[ Lời mời kết bạn ]
```

The body remains scrollable.

The handle area is the only drag-to-dismiss area, matching `MobileSheet`.

This is exactly the same interaction model already used by QueueSheet / TrackActionsSheet.

---

# 24. Friend request UX

Incoming request:

```text
[avatar] Display Name
@handle

Muốn kết bạn với bạn

[Chấp nhận] [Từ chối]
```

Outgoing:

```text
[avatar] Display Name
@handle

Đã gửi lời mời

[Huỷ lời mời]
```

Accepted:

```text
[avatar] Display Name
@handle

● Online
[activity]
```

Blocked:

```text
Không hiển thị activity
Không cho phép tạo friendship
```

---

# 25. Search result card

```text
[avatar]  Display Name
          @handle

          [Kết bạn]
```

When already connected:

```text
[avatar] Display Name
          @handle

          ✓ Bạn bè
```

When pending:

```text
          Đã gửi lời mời
```

Do not expose emails.

---

# 26. Profile viewing

Clicking a friend should open a compact profile surface or route.

V1:

```text
Avatar
Display Name
@handle
online state
current activity
```

Later:

```text
shared playlists
recent activity
social interactions
```

Do not build a giant profile/social feed in V1.

---

# 27. Integration with player

The social layer should subscribe to player state changes.

Canonical events of interest:

```text
current track changed
playback started
playback paused
seeked
playback resumed
playback stopped
player destroyed/unmounted
```

The social adapter maps these to:

```text
LISTENING
PAUSED
ONLINE
OFFLINE
```

The social adapter should never modify queue/election semantics.

---

# 28. Multi-tab behavior

Duckroom already has multi-tab playback arbitration.

For social presence:

- only the tab that actually owns active playback should report `LISTENING`
- other tabs must not fight over the same social activity
- if another tab is logged in but is not the playback owner, it can remain `ONLINE`

Recommended rule:

```text
playback leader + playing
  => LISTENING

playback leader + paused
  => PAUSED

non-leader
  => ONLINE
```

The social module may consume the player leader state, but must not reimplement leader election.

---

# 29. Lifecycle / disconnect

On clean unload where possible:

```text
untrack presence
send final social state
cleanup channel
```

But unload hooks are only an optimization.

The actual authority for “offline” is the recipient's stale timeout.

That protects against:

- laptop sleep
- browser crash
- network loss
- tab kill
- mobile OS suspension

---

# 30. Consistency rules

Use a monotonically increasing:

```text
revision
```

for activity updates.

Receiver ignores an update when:

```text
incoming.revision < current.revision
```

This protects against out-of-order Broadcast delivery.

Additionally:

```text
incoming.updatedAt <= known.updatedAt
```

can be used as a secondary sanity check.

Never let a delayed event rewind the UI.

---

# 31. Security rules

## Profile

- member-only access for social profile operations
- no email disclosure
- safe handle normalization
- safe friend-code lookup
- rate-limited search

## Friendship

- no self friendship
- canonical pair uniqueness
- block enforcement
- authorization on every mutation

## Realtime

- private topics
- RLS on `realtime.messages`
- owner-only publishing
- accepted-friend receiving rule

## Media

- do not expose track metadata that the viewer cannot access
- do not expose signed S3 URLs in social presence payloads

## Trust model

Treat client-reported activity as **untrusted presentation data**.

A malicious client can claim:

```text
“I am listening to track X”
```

That must never become a permission check, billing fact, audit fact, or security authority.

---

# 32. Rate limiting

Reuse the existing rate-limit architecture.

Suggested V1 limits:

```text
friend search:
  30 / minute / IP

send request:
  20 / minute / authenticated user

block/unblock:
  20 / minute / authenticated user
```

Adjust after telemetry.

Do not use in-memory limits as a false claim of distributed enforcement; the current project already documents that its rate limiting is suitable for small/single-instance use.

---

# 33. Database migrations

Expected migration sequence:

```text
20260918_duckroom_v2_social_profiles.sql
20260918_duckroom_v2_friendships.sql
20260918_duckroom_v2_realtime_authorization.sql
```

Potential responsibilities:

### Social profile migration

- add handle
- add avatar storage key
- add friend code
- add privacy columns
- constraints/indexes
- backfill strategy

### Friendships migration

- create canonical relationship table
- constraints
- indexes
- RLS
- blocking semantics

### Realtime authorization migration

- `realtime.messages` policies
- private-channel enforcement
- publish/receive rules
- friendship-aware authorization

All migrations remain append-only.

---

# 34. Profile backfill

Existing members already have profiles.

Backfill rules:

```text
display_name:
  preserve existing value

handle:
  deterministic generated temporary handle
  → user prompted to customize later

friend_code:
  generated server-side

avatar:
  null
```

Never generate fake human names.

Example temporary handle:

```text
duck_8F3Q2M
```

This is an identifier, not a display-name fabrication.

---

# 35. Query strategy

For `/friends`:

1. fetch current accepted friendship IDs
2. fetch minimal profile rows
3. subscribe to each friend topic
4. merge realtime activity into a local social store
5. render from the store

Do not:

```text
poll Postgres every 5 seconds
```

Do not:

```text
query `profiles` every time an activity packet arrives
```

Use a profile cache keyed by `userId`.

---

# 36. Suggested client store

Conceptually:

```ts
type FriendPresenceMap = Record<
  string,
  {
    status: "online" | "listening" | "paused" | "offline";
    activity: SocialListeningActivity | null;
    receivedAt: number;
    revision: number;
  }
>;
```

The store should expose:

```text
getFriendPresence(userId)
getAllFriendPresence()
subscribe()
```

UI components should subscribe narrowly.

Do not put a time tick at the top of `/friends` that rerenders the entire page every frame.

Progress interpolation must be isolated just like the current player time subscribers are isolated.

---

# 37. Performance rules

Do not break Duckroom's recent performance work.

### Forbidden

```text
usePlayer() at top of giant Friends page
```

if only a tiny child needs changing state.

### Preferred

```text
FriendsPage
 ├─ FriendList
 │    ├─ FriendCard
 │    │    └─ FriendProgress
 │    │         └─ tiny time subscription
```

Only activity/progress subnodes update frequently.

The whole friend list should not rerender every heartbeat.

---

# 38. Motion rules

Match current Duckroom conventions:

- spring for sheet/card entry
- CSS transitions for simple state changes
- no `layoutId` for decorative route transitions
- respect reduced motion automatically
- no staggered “social media” animation on every friend
- status indicator can use subtle CSS pulse
- avoid animated glow continuously consuming GPU for every friend card

Presence should feel alive, not noisy.

---

# 39. Accessibility

Every interactive control:

- keyboard accessible
- 44px-ish touch target on mobile
- visible focus state
- correct `aria-label`
- correct `aria-expanded` for sheets
- dialogs use `aria-modal`
- search input has associated label

Status colors are not the sole signal:

```text
● Online
♪ Đang nghe
Ⅱ Tạm dừng
○ Offline
```

The text state remains visible.

---

# 40. L1 acceptance criteria

Feature is L1-complete when all are true:

### Profile

- [ ] Member can set avatar
- [ ] Member can set display name
- [ ] Member can choose unique `@handle`
- [ ] Member receives a unique friend code
- [ ] Email is not used for public discovery
- [ ] Profile is reachable from shell account UI

### Friend graph

- [ ] Search by exact `@handle`
- [ ] Search by exact friend code
- [ ] Send request
- [ ] Accept request
- [ ] Reject/cancel request
- [ ] Remove friend
- [ ] Block/unblock
- [ ] Duplicate/self/blocked edge cases covered

### Presence

- [ ] Online
- [ ] Listening
- [ ] Paused
- [ ] Offline after stale >10s
- [ ] Reconnect restores state
- [ ] Track change updates activity
- [ ] Pause updates activity
- [ ] Seek updates position
- [ ] Playback progress interpolates locally

### Privacy

- [ ] Friends only
- [ ] Ghost mode
- [ ] Separate presence/listening controls
- [ ] Private track does not leak metadata
- [ ] Realtime authorization blocks non-friends

### UX

- [ ] Desktop `/friends`
- [ ] Desktop profile entry
- [ ] Mobile Friends button
- [ ] Mobile Friends `MobileSheet`
- [ ] No sixth bottom nav item
- [ ] Existing player continues working unchanged
- [ ] Existing theme system works unchanged

---

# 41. Test plan

## Unit tests

Create tests for:

```text
profile normalization
handle validation
friend code validation
canonical friendship pair
friendship state transitions
block semantics
presence reducer
revision ordering
10s stale timeout
play/pause/seek activity transitions
private-media fallback
```

## Integration tests

Test:

```text
member A requests B
member B accepts
A can subscribe to B
unrelated member C cannot receive B
blocked user cannot receive B
```

Also test:

```text
friend removed
→ realtime subscription removed
```

## Realtime authorization tests

These should be explicit.

Examples:

```text
friend:
  ALLOW receive

non-friend:
  DENY receive

owner of topic:
  ALLOW publish

different user:
  DENY publish

blocked:
  DENY receive
```

## Browser E2E

At minimum:

```text
desktop Chrome
mobile viewport
two authenticated browser contexts
```

Scenario:

```text
User A opens Duckroom
User B opens Duckroom

A friends B

B presses Play
A sees B as Listening

B pauses
A sees Paused

B seeks
A progress updates

B closes tab
A eventually sees Offline
```

This is the first test that proves the actual feature rather than mocked internals.

---

# 42. Production verification

Do not mark release-ready only because local tests are green.

Required external validation:

```text
live Supabase migration applied
Realtime RLS verified
private channels verified
friend-only delivery verified
production two-client test verified
mobile UI verified on target widths
credential/key configuration verified
```

Supabase's current documentation also recommends the newer publishable/secret key naming instead of legacy `anon`/`service_role` keys; this social feature should not introduce new dependency on the legacy names.

---

# 43. Suggested implementation phases

## Phase 0 — social contract

Deliver:

```text
docs/DUCKROOM_FRIENDS_DESIGN.md
```

Lock:

- identity rules
- privacy rules
- relationship state machine
- realtime topology
- event model
- UI entry points

No production code yet.

---

## Phase 1 — Profile

Implement:

```text
profiles.handle
profiles.avatar_storage_key
profiles.friend_code
profiles.presence_visibility
profiles.listening_visibility
```

Build:

```text
/profile
profile editor
avatar upload
profile read model
```

Test profile constraints first.

---

## Phase 2 — Friend Graph

Implement:

```text
friendships table
RLS
server mutations
search endpoint
request UI
```

Build:

```text
/friends
```

but initially without live presence.

This isolates the durable graph.

---

## Phase 3 — Realtime Presence

Implement:

```text
social-presence.ts
social-store.ts
social-subscriptions.ts
```

Wire:

```text
player state
     ↓
social adapter
     ↓
Presence + Broadcast
```

No UI polish yet.

---

## Phase 4 — Friends UI

Desktop:

```text
sidebar → Bạn bè
/friends
```

Mobile:

```text
header → Friends icon
        → MobileSheet
```

Account:

```text
account block → /profile
```

---

## Phase 5 — Hardening

Verify:

```text
RLS
privacy
block
reconnect
10s stale
out-of-order packets
multi-tab
private tracks
mobile
reduced motion
```

Then run the two-browser E2E scenario.

---

# 44. File-level implementation map

Expected core additions:

```text
src/routes/profile.tsx
src/routes/friends.tsx

src/components/social/
├── ProfileAvatar.tsx
├── ProfileCard.tsx
├── FriendSearch.tsx
├── FriendRequestRow.tsx
├── FriendCard.tsx
├── FriendActivity.tsx
├── PresenceDot.tsx
└── FriendsSheet.tsx

src/lib/social/
├── social-types.ts
├── social-store.ts
├── social-presence.ts
├── social-subscriptions.ts
├── social-profile.server.ts
├── social-friendships.server.ts
└── index.ts
```

Potential existing files touched:

```text
src/components/AppShell.tsx
src/lib/db-types.ts
src/lib/rate-limit.ts
src/lib/s3.ts
src/lib/supabase-client.ts
src/routes/__root.tsx   // only if provider mounting is required
```

Do not modify player election logic unless an actual integration requirement proves it necessary.

---

# 45. What NOT to build in L1

Explicitly out of scope:

```text
Listen Along
shared playback clock
social chat
typing indicators
DMs
activity history
last song history
Discord-style server/guild system
rich social feed
likes/reactions to songs
notifications center
friend recommendation algorithm
```

Also do not build:

```text
per-second Postgres playback writes
per-second Presence.track()
global all-member presence leakage
email-based public identity
giant monolithic `social.ts`
```

---

# 46. L2

Deferred interaction:

```text
Click friend activity
    ↓
open track
    ↓
check access
    ↓
play
```

Rules:

- track must still exist
- viewer must have access
- deleted/private content falls back safely
- no automatic playback sync

---

# 47. L3 — Listen Along

This is a separate distributed systems feature.

It requires:

```text
host/follower roles
authoritative playback position
drift correction
seek propagation
pause propagation
disconnect recovery
latency tolerance
session lifecycle
conflict handling
```

Therefore it should be designed as a separate project after L2, not smuggled into the L1 presence implementation.

---

# 48. Final architecture

```text
                         ┌──────────────────────┐
                         │ Supabase PostgreSQL  │
                         │                      │
                         │ profiles             │
                         │ friendships          │
                         │ privacy              │
                         └──────────┬───────────┘
                                    │
                          canonical durable data
                                    │
                    ┌───────────────▼────────────────┐
                    │        Duckroom Social         │
                    │                                │
                    │ profile / friends / policy     │
                    │ social store                   │
                    └───────────────┬────────────────┘
                                    │
                     realtime authorization boundary
                                    │
                 ┌──────────────────┴──────────────────┐
                 │                                     │
       social:user:<alice>                   social:user:<bob>
                 │                                     │
         Presence + Broadcast                  Presence + Broadcast
                 │                                     │
                 └──────────────────┬──────────────────┘
                                    │
                              Friends UI
                                    │
                ┌───────────────────┴───────────────────┐
                │                                       │
           Desktop /friends                       Mobile Sheet
                │                                       │
                └───────────────────┬───────────────────┘
                                    │
                              Profile / Activity
                                    │
                              Player Engine
```

---

# 49. Final senior sign-off criteria

Do not start implementation until these statements remain true:

1. `profiles` is the identity source for Duckroom social features.
2. Friend discovery never depends on email.
3. Friendship is durable Postgres state.
4. Presence is ephemeral realtime state.
5. Presence is not a database polling system.
6. Broadcast handles heartbeat/custom ephemeral updates.
7. Realtime authorization is friend-aware.
8. A global presence channel is not used as a shortcut.
9. `player-broadcast.ts` remains isolated to multi-tab playback arbitration.
10. Current Duckroom mobile architecture remains 5 bottom-nav destinations.
11. `MobileSheet` is reused.
12. Social UI adopts the current glass/card/soft-shadow language.
13. Activity position is interpolated locally.
14. `paused` remains online.
15. `offline` means stale >10s at the application level.
16. Private media metadata never leaks through presence.
17. L2/L3 stay deferred.

---

# 50. One-line implementation brief

> Build Duckroom Friends as a real profile + friend graph system first, then layer friend-scoped private Realtime Presence/Broadcast on top of the existing Player Engine, preserving the current AppShell/mobile-sheet/player architecture and enforcing privacy at both Postgres and Realtime authorization boundaries.
