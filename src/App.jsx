import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const STORAGE_KEY = "summer-goals-v2";
const DAILY_GOAL_TARGET_RATE = 0.7;
const SUPABASE_TABLE = "summer_goal_state";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `goal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(start, end) {
  const startDate = parseDateOnly(start);
  const endDate = parseDateOnly(end);

  if (!startDate || !endDate) return 1;

  return Math.max(1, Math.round((endDate - startDate) / 86400000) + 1);
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function getSeasonElapsedDays(seasonStart, seasonEnd, currentDateKey) {
  const startDate = parseDateOnly(seasonStart);
  const endDate = parseDateOnly(seasonEnd);
  const currentDate = parseDateOnly(currentDateKey);

  if (!startDate || !endDate || !currentDate) return 1;
  if (currentDate < startDate) return 0;
  if (currentDate > endDate) return daysBetween(seasonStart, seasonEnd);

  return daysBetween(seasonStart, currentDateKey);
}

function countGoalCompletionsInSeason(goal, seasonStart, seasonEnd) {
  return Object.keys(goal.completions ?? {}).filter(
    (date) => date >= seasonStart && date <= seasonEnd
  ).length;
}

function getDailyGoalRequiredDays(seasonStart, seasonEnd) {
  const totalDays = daysBetween(seasonStart, seasonEnd);
  return Math.ceil(totalDays * DAILY_GOAL_TARGET_RATE);
}

function getDailyGoalProgressToTarget(goal, seasonStart, seasonEnd) {
  const completedDays = countGoalCompletionsInSeason(goal, seasonStart, seasonEnd);
  const requiredDays = getDailyGoalRequiredDays(seasonStart, seasonEnd);

  if (requiredDays <= 0) return 0;
  return clamp(Math.round((completedDays / requiredDays) * 100));
}

function getDailyGoalProjectedTotal(goal, seasonStart, seasonEnd, currentDateKey) {
  const completedSoFar = countGoalCompletionsInSeason(goal, seasonStart, seasonEnd);
  const elapsedDays = getSeasonElapsedDays(seasonStart, seasonEnd, currentDateKey);
  const totalSeasonDays = daysBetween(seasonStart, seasonEnd);

  if (elapsedDays <= 0) return 0;

  const projected = Math.round((completedSoFar / elapsedDays) * totalSeasonDays);
  return Math.min(projected, totalSeasonDays);
}

function isDailyGoalOnTrack(goal, seasonStart, seasonEnd, currentDateKey) {
  const projectedTotal = getDailyGoalProjectedTotal(goal, seasonStart, seasonEnd, currentDateKey);
  const requiredDays = getDailyGoalRequiredDays(seasonStart, seasonEnd);
  return projectedTotal >= requiredDays;
}

function isGoalSuccessfulNow(goal, seasonStart, seasonEnd) {
  if (goal.type === "long-term") return !!goal.completed;

  const completedDays = countGoalCompletionsInSeason(goal, seasonStart, seasonEnd);
  const requiredDays = getDailyGoalRequiredDays(seasonStart, seasonEnd);
  return completedDays >= requiredDays;
}

function getDailyStreak(goal, currentDateKey) {
  if (goal.type !== "daily") return 0;

  let count = 0;
  const date = parseDateOnly(currentDateKey);
  if (!date) return 0;

  while (true) {
    const key = todayKey(date);
    if (!goal.completions?.[key]) break;
    count += 1;
    date.setDate(date.getDate() - 1);
  }

  return count;
}

function readLegacyLocalState(currentYear) {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;

    const parsed = JSON.parse(saved);
    return {
      goals: Array.isArray(parsed.goals) ? parsed.goals : defaultGoals,
      seasonStart: parsed.seasonStart ?? `${currentYear}-06-01`,
      seasonEnd: parsed.seasonEnd ?? `${currentYear}-08-31`,
    };
  } catch {
    return null;
  }
}

function runHelperTests() {
  const dailyGoal = {
    type: "daily",
    completions: {
      "2026-06-01": true,
      "2026-06-02": true,
      "2026-06-03": true,
      "2026-06-04": true,
      "2026-06-05": true,
      "2026-06-06": true,
      "2026-06-07": true,
      "2026-09-01": true,
    },
  };

  console.assert(daysBetween("2026-06-01", "2026-06-03") === 3, "daysBetween includes both start and end dates");
  console.assert(daysBetween("bad-date", "2026-06-03") === 1, "daysBetween falls back safely for invalid dates");
  console.assert(clamp(150) === 100, "clamp caps values at 100");
  console.assert(clamp(-20) === 0, "clamp floors values at 0");
  console.assert(getDailyGoalRequiredDays("2026-06-01", "2026-06-10") === 7, "70 percent target rounds up");
  console.assert(
    getDailyGoalProgressToTarget(dailyGoal, "2026-06-01", "2026-06-10") === 100,
    "daily goal progress reaches 100 percent when the 70 percent target is met"
  );
  console.assert(
    isGoalSuccessfulNow(dailyGoal, "2026-06-01", "2026-06-10") === true,
    "daily goal counts as successful after hitting the 70 percent target"
  );
  console.assert(
    getDailyStreak(dailyGoal, "2026-06-07") === 7,
    "daily streak counts consecutive completed days ending today"
  );
  console.assert(
    getDailyGoalProjectedTotal(
      { type: "daily", completions: { "2026-06-01": true, "2026-06-02": true } },
      "2026-06-01",
      "2026-06-10",
      "2026-06-02"
    ) === 10,
    "projection estimates full-season completion from current pace"
  );
}

if (typeof window !== "undefined" && !window.__SUMMER_GOAL_TESTS_RAN__) {
  window.__SUMMER_GOAL_TESTS_RAN__ = true;
  runHelperTests();
}

const defaultGoals = [
  {
    id: makeId(),
    title: "Hit the gym",
    type: "daily",
    category: "Fitness",
    notes: "Show up, even if it is a short workout.",
    completions: {},
    completed: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: makeId(),
    title: "Go hiking at a new place",
    type: "long-term",
    category: "Adventure",
    notes: "Pick a trail, invite a friend, and take photos.",
    completions: {},
    completed: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: makeId(),
    title: "Complete my personal project",
    type: "long-term",
    category: "Personal Project",
    notes: "Break it into small weekly milestones.",
    completions: {},
    completed: false,
    createdAt: new Date().toISOString(),
  },
];

const typeCopy = {
  daily: {
    label: "Daily goal",
    description: "Complete this on at least 70% of summer days.",
    icon: "📅",
  },
  "long-term": {
    label: "Long-term goal",
    description: "Complete this once by the end of summer.",
    icon: "🏆",
  },
};

const categoryIcons = {
  Fitness: "🏋️",
  Adventure: "🥾",
  "Personal Project": "🛠️",
  Wellness: "✨",
  Learning: "📚",
  Other: "🎯",
};

const categories = Object.keys(categoryIcons);

const surface = "border border-[#B9C9DA]/75 bg-[#F3F7FB]/78 shadow-xl shadow-[#21415F]/10 backdrop-blur";
const innerSurface = "border border-[#B9C9DA]/70 bg-[#E7F0F8]/72";
const softSurface = "border border-[#AFC2D6]/65 bg-[#D9E7F5]/62";
const textMain = "text-[#1D2D3C]";
const textSoft = "text-[#4F657A]";
const focusRing = "focus:border-[#5D86B3] focus:ring-4 focus:ring-[#5D86B3]/18";

export default function SummerGoalTracker() {
  const currentYear = new Date().getFullYear();
  const [goals, setGoals] = useState(defaultGoals);
  const [filter, setFilter] = useState("all");
  const [seasonStart, setSeasonStart] = useState(`${currentYear}-06-01`);
  const [seasonEnd, setSeasonEnd] = useState(`${currentYear}-08-31`);
  const [newGoal, setNewGoal] = useState({
    title: "",
    type: "daily",
    category: "Fitness",
    notes: "",
  });
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Not synced yet");
  const [cloudError, setCloudError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      const { data, error } = await supabase.auth.getSession();

      if (!mounted) return;

      if (error) {
        setCloudError(error.message);
      }

      setSession(data?.session ?? null);
      setAuthLoading(false);
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
      setCloudLoaded(false);
      setCloudError("");
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) return;

    let cancelled = false;

    async function loadCloudState() {
      setCloudLoaded(false);
      setSaveStatus("Loading cloud data...");
      setCloudError("");

      const { data, error } = await supabase
        .from(SUPABASE_TABLE)
        .select("state")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error(error);
        setCloudError(error.message);
        setSaveStatus("Cloud load failed");
        setCloudLoaded(true);
        return;
      }

      const cloudState = data?.state;
      const legacyState = readLegacyLocalState(currentYear);
      const nextState = cloudState ?? legacyState;

      if (nextState) {
        setGoals(Array.isArray(nextState.goals) ? nextState.goals : defaultGoals);
        setSeasonStart(nextState.seasonStart ?? `${currentYear}-06-01`);
        setSeasonEnd(nextState.seasonEnd ?? `${currentYear}-08-31`);
      }

      setCloudLoaded(true);
      setSaveStatus(cloudState ? "Saved" : legacyState ? "Ready to sync local data" : "Saved");
    }

    loadCloudState();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, currentYear]);

  useEffect(() => {
    if (!session?.user || !cloudLoaded) return;

    setSaveStatus("Saving...");
    setCloudError("");

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ goals, seasonStart, seasonEnd }));
    } catch {
      // Local backup can fail in restricted environments. Cloud saving still works.
    }

    const timeoutId = setTimeout(async () => {
      const { error } = await supabase.from(SUPABASE_TABLE).upsert(
        {
          user_id: session.user.id,
          state: {
            goals,
            seasonStart,
            seasonEnd,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      if (error) {
        console.error(error);
        setCloudError(error.message);
        setSaveStatus("Save failed");
      } else {
        setSaveStatus("Saved");
      }
    }, 600);

    return () => clearTimeout(timeoutId);
  }, [goals, seasonStart, seasonEnd, session?.user?.id, cloudLoaded]);

  const today = todayKey();

  const seasonStats = useMemo(() => {
    const totalSeasonDays = daysBetween(seasonStart, seasonEnd);
    const elapsedSeasonDays = getSeasonElapsedDays(seasonStart, seasonEnd, today);
    const summerElapsedPercent = totalSeasonDays > 0
      ? clamp(Math.round((elapsedSeasonDays / totalSeasonDays) * 100))
      : 0;

    const dailyGoals = goals.filter((goal) => goal.type === "daily");
    const longTermGoals = goals.filter((goal) => goal.type === "long-term");
    const dailyDoneToday = dailyGoals.filter((goal) => goal.completions?.[today]).length;
    const completedLongTermGoals = longTermGoals.filter((goal) => goal.completed).length;

    const dailyGoalsAlreadyMet = dailyGoals.filter((goal) =>
      isGoalSuccessfulNow(goal, seasonStart, seasonEnd)
    ).length;

    const dailyGoalsProjectedMet = dailyGoals.filter((goal) =>
      isDailyGoalOnTrack(goal, seasonStart, seasonEnd, today)
    ).length;

    const overallCurrentProgressPercent = goals.length
      ? Math.round(
          goals.reduce((sum, goal) => {
            if (goal.type === "long-term") {
              return sum + (goal.completed ? 100 : 0);
            }
            return sum + getDailyGoalProgressToTarget(goal, seasonStart, seasonEnd);
          }, 0) / goals.length
        )
      : 0;

    const projectedSuccessfulGoals = completedLongTermGoals + dailyGoalsProjectedMet;
    const onTrackDelta = overallCurrentProgressPercent - summerElapsedPercent;

    let paceLabel = "On track";
    let paceTone = "blue";

    if (onTrackDelta >= 10) {
      paceLabel = "Ahead of pace";
      paceTone = "teal";
    } else if (onTrackDelta < -10) {
      paceLabel = "Behind pace";
      paceTone = "red";
    }

    return {
      totalSeasonDays,
      elapsedSeasonDays,
      summerElapsedPercent,
      dailyGoals,
      longTermGoals,
      dailyDoneToday,
      completedLongTermGoals,
      dailyGoalsAlreadyMet,
      dailyGoalsProjectedMet,
      overallCurrentProgressPercent: clamp(overallCurrentProgressPercent),
      projectedSuccessfulGoals,
      paceLabel,
      paceTone,
      dailyGoalRequiredDays: getDailyGoalRequiredDays(seasonStart, seasonEnd),
    };
  }, [goals, seasonStart, seasonEnd, today]);

  const filteredGoals = useMemo(() => {
    if (filter === "all") return goals;
    return goals.filter((goal) => goal.type === filter);
  }, [goals, filter]);

  function addGoal(event) {
    event.preventDefault();
    const title = newGoal.title.trim();
    if (!title) return;

    setGoals((current) => [
      {
        id: makeId(),
        title,
        type: newGoal.type,
        category: newGoal.category,
        notes: newGoal.notes.trim(),
        completions: {},
        completed: false,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);

    setNewGoal({ title: "", type: "daily", category: "Fitness", notes: "" });
  }

  function removeGoal(id) {
    setGoals((current) => current.filter((goal) => goal.id !== id));
  }

  function toggleGoal(goal) {
    setGoals((current) =>
      current.map((item) => {
        if (item.id !== goal.id) return item;

        if (item.type === "daily") {
          const nextCompletions = { ...(item.completions ?? {}) };
          if (nextCompletions[today]) {
            delete nextCompletions[today];
          } else {
            nextCompletions[today] = true;
          }
          return { ...item, completions: nextCompletions };
        }

        return { ...item, completed: !item.completed };
      })
    );
  }

  function resetAllData() {
    setGoals(
      defaultGoals.map((goal) => ({
        ...goal,
        id: makeId(),
        completions: {},
        completed: false,
      }))
    );
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setCloudLoaded(false);
  }

  if (authLoading) {
    return <LoadingScreen message="Loading your dashboard..." />;
  }

  if (!session) {
    return <LoginScreen />;
  }

  if (!cloudLoaded) {
    return <LoadingScreen message="Loading your goals from the cloud..." />;
  }

  return (
    <div className="min-h-screen overflow-hidden bg-gradient-to-br from-[#DCEAF7] via-[#CBDDF0] to-[#B8D0E6] p-4 text-[#1D2D3C] sm:p-6 lg:p-8">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-[-8rem] top-[-7rem] h-96 w-96 rounded-full bg-[#F7FBFF]/65 blur-3xl" />
        <div className="absolute right-[-8rem] top-[4rem] h-[28rem] w-[28rem] rounded-full bg-[#6EA8D9]/24 blur-3xl" />
        <div className="absolute bottom-[-12rem] left-[22%] h-[32rem] w-[32rem] rounded-full bg-[#2F6F9F]/18 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl space-y-6">
        <header className={`overflow-hidden rounded-[2rem] p-6 md:p-8 ${surface}`}>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge icon="🌊" tone="blue">Blue summer dashboard</Badge>
                <Badge icon="☁️" tone={saveStatus === "Saved" ? "teal" : saveStatus === "Save failed" || saveStatus === "Cloud load failed" ? "red" : "blue"}>
                  {saveStatus}
                </Badge>
              </div>
              <div>
                <h1 className={`text-4xl font-black tracking-tight md:text-6xl ${textMain}`}>
                  Build your best summer.
                </h1>
                <p className={`mt-3 max-w-2xl text-base leading-7 md:text-lg ${textSoft}`}>
                  Track daily habits, one-time adventures, and personal projects in a calm, blue-toned workspace.
                </p>
              </div>
              {cloudError && (
                <div className="rounded-2xl border border-[#C96F6F]/34 bg-[#C96F6F]/10 p-3 text-sm font-semibold text-[#9A4B4B]">
                  Cloud sync issue: {cloudError}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className={`grid gap-3 rounded-3xl p-4 shadow-lg shadow-[#21415F]/10 sm:grid-cols-2 ${softSurface}`}>
                <DateField label="Start" value={seasonStart} onChange={setSeasonStart} />
                <DateField label="End" value={seasonEnd} onChange={setSeasonEnd} />
              </div>
              <div className="flex flex-col gap-2 rounded-3xl border border-[#AFC2D6]/65 bg-[#D9E7F5]/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs font-bold text-[#4F657A]">
                  Signed in as <span className="text-[#1D2D3C]">{session.user.email}</span>
                </div>
                <button
                  onClick={signOut}
                  className="rounded-full border border-[#AFC2D6]/80 bg-[#E7F0F8]/72 px-3 py-1 text-xs font-bold text-[#4F657A] transition hover:bg-[#D9E7F5]"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.35fr_0.95fr]">
          <div className={`rounded-[2rem] p-6 ${surface}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className={`text-2xl font-black ${textMain}`}>Overall Summer Progress</h2>
                <p className={`mt-1 text-sm ${textSoft}`}>
                  Compare your goal progress against how far summer has gone.
                </p>
              </div>
              <Badge icon="📈" tone={seasonStats.paceTone}>{seasonStats.paceLabel}</Badge>
            </div>

            <div className="mt-6 space-y-5">
              <ProgressBar label="Summer elapsed" value={seasonStats.summerElapsedPercent} muted />
              <ProgressBar label="Your overall goal progress" value={seasonStats.overallCurrentProgressPercent} />

              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard label="Summer days" value={`${seasonStats.elapsedSeasonDays}/${seasonStats.totalSeasonDays}`} />
                <MetricCard label="Daily target" value={`${seasonStats.dailyGoalRequiredDays} days`} />
                <MetricCard label="Pace" value={seasonStats.paceLabel} />
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-[#9EB7D0]/70 bg-gradient-to-br from-[#496D91] via-[#3F668E] to-[#315B7F] p-6 text-[#F2F7FC] shadow-xl shadow-[#21415F]/18">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">End-of-Summer Projection</h2>
                <p className="mt-2 text-sm leading-6 text-[#D6E5F3]">
                  Based on your current pace, this is where you’re likely to finish.
                </p>
              </div>
              <div className="text-4xl">🏁</div>
            </div>

            <div className="mt-6 rounded-3xl border border-[#F2F7FC]/18 bg-[#F2F7FC]/12 p-5 shadow-inner shadow-black/5">
              <div className="text-sm uppercase tracking-wide text-[#C8DAEA]">Projected outcome</div>
              <div className="mt-2 text-4xl font-black text-[#F2F7FC]">
                {seasonStats.projectedSuccessfulGoals}/{goals.length}
              </div>
              <div className="mt-2 text-sm text-[#D6E5F3]">
                goals likely to be successfully completed by the end of summer
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <ProjectionRow label="Daily goals on track" value={`${seasonStats.dailyGoalsProjectedMet}/${seasonStats.dailyGoals.length}`} />
              <ProjectionRow label="Long-term goals completed" value={`${seasonStats.completedLongTermGoals}/${seasonStats.longTermGoals.length}`} />
              <ProjectionRow label="Success rule" value="Daily goals need 70%" />
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <StatCard icon="🎯" label="Total goals" value={goals.length} subtext="Active summer goals" />
          <StatCard icon="✅" label="Daily goals met" value={`${seasonStats.dailyGoalsAlreadyMet}/${seasonStats.dailyGoals.length}`} subtext="Reached the 70% target" />
          <StatCard icon="🏆" label="Milestones" value={`${seasonStats.completedLongTermGoals}/${seasonStats.longTermGoals.length}`} subtext="Long-term goals done" />
          <StatCard icon="🔥" label="Overall" value={`${seasonStats.overallCurrentProgressPercent}%`} subtext="Progress toward all goals" />
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.55fr]">
          <form onSubmit={addGoal} className={`rounded-[2rem] p-5 ${surface}`}>
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#376996] text-xl font-black text-[#F3F8FC] shadow-lg shadow-[#21415F]/18 ring-1 ring-[#2D5D86]/45">
                +
              </div>
              <div>
                <h2 className={`text-xl font-bold ${textMain}`}>Add a goal</h2>
                <p className={`text-sm ${textSoft}`}>Create daily habits or one-time wins.</p>
              </div>
            </div>

            <div className="space-y-4">
              <label className="block space-y-2">
                <span className={`text-sm font-semibold ${textSoft}`}>Goal name</span>
                <input
                  value={newGoal.title}
                  onChange={(event) => setNewGoal({ ...newGoal, title: event.target.value })}
                  placeholder="Example: Go hiking at Starved Rock"
                  className={`w-full rounded-2xl border border-[#AFC2D6] bg-[#EFF6FC]/82 px-4 py-3 text-[#1D2D3C] outline-none transition placeholder:text-[#7390A8] ${focusRing}`}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(typeCopy).map(([type, copy]) => {
                  const selected = newGoal.type === type;
                  return (
                    <button
                      type="button"
                      key={type}
                      onClick={() => setNewGoal({ ...newGoal, type })}
                      className={`rounded-2xl border p-4 text-left transition ${
                        selected
                          ? "border-[#5D86B3]/70 bg-[#D6E8F8]/85 shadow-lg shadow-[#21415F]/10"
                          : "border-[#AFC2D6]/80 bg-[#EFF6FC]/58 hover:border-[#7699B9] hover:bg-[#F4F9FD]/85"
                      }`}
                    >
                      <div className="mb-3 text-2xl">{copy.icon}</div>
                      <div className={`font-bold ${textMain}`}>{copy.label}</div>
                      <div className={`text-sm ${textSoft}`}>{copy.description}</div>
                    </button>
                  );
                })}
              </div>

              <label className="block space-y-2">
                <span className={`text-sm font-semibold ${textSoft}`}>Category</span>
                <select
                  value={newGoal.category}
                  onChange={(event) => setNewGoal({ ...newGoal, category: event.target.value })}
                  className={`w-full rounded-2xl border border-[#AFC2D6] bg-[#EFF6FC]/82 px-4 py-3 text-[#1D2D3C] outline-none transition ${focusRing}`}
                >
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>

              <label className="block space-y-2">
                <span className={`text-sm font-semibold ${textSoft}`}>Notes or location</span>
                <textarea
                  value={newGoal.notes}
                  onChange={(event) => setNewGoal({ ...newGoal, notes: event.target.value })}
                  placeholder="Add the trail name, project details, or motivation."
                  rows={4}
                  className={`w-full resize-none rounded-2xl border border-[#AFC2D6] bg-[#EFF6FC]/82 px-4 py-3 text-[#1D2D3C] outline-none transition placeholder:text-[#7390A8] ${focusRing}`}
                />
              </label>

              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#376996] px-5 py-3 font-black text-[#F3F8FC] shadow-lg shadow-[#21415F]/18 ring-1 ring-[#2D5D86]/45 transition hover:-translate-y-0.5 hover:bg-[#2F5D87]"
              >
                <span className="text-xl leading-none">+</span> Add goal
              </button>
            </div>
          </form>

          <div className="space-y-4">
            <div className={`rounded-[2rem] p-5 ${surface}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className={`text-xl font-bold ${textMain}`}>Your goals</h2>
                  <p className={`text-sm ${textSoft}`}>Check off today’s habits and finish summer milestones.</p>
                </div>
                <div className={`flex rounded-2xl p-1 ${softSurface}`}>
                  {[
                    ["all", "All"],
                    ["daily", "Daily"],
                    ["long-term", "Long-term"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setFilter(key)}
                      className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                        filter === key
                          ? "bg-[#F3F8FC]/88 text-[#1D2D3C] shadow-sm ring-1 ring-[#AFC2D6]/70"
                          : "text-[#4F657A] hover:text-[#1D2D3C]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5 grid gap-4">
                {filteredGoals.map((goal) => {
                  const icon = categoryIcons[goal.category] ?? categoryIcons.Other;
                  const checked = goal.type === "daily" ? goal.completions?.[today] : goal.completed;
                  const currentStreak = getDailyStreak(goal, today);

                  let percent = 0;
                  let secondaryText = "";

                  if (goal.type === "daily") {
                    const completedDays = countGoalCompletionsInSeason(goal, seasonStart, seasonEnd);
                    const requiredDays = getDailyGoalRequiredDays(seasonStart, seasonEnd);
                    const projectedDays = getDailyGoalProjectedTotal(goal, seasonStart, seasonEnd, today);

                    percent = getDailyGoalProgressToTarget(goal, seasonStart, seasonEnd);
                    secondaryText = `${completedDays}/${requiredDays} target days • projected ${projectedDays}`;
                  } else {
                    percent = goal.completed ? 100 : 0;
                    secondaryText = goal.completed ? "Completed" : "Still in progress";
                  }

                  return (
                    <article
                      key={goal.id}
                      className={`rounded-3xl p-4 shadow-lg shadow-[#21415F]/10 transition hover:border-[#7CA0BF] hover:bg-[#F1F7FC]/86 ${innerSurface}`}
                    >
                      <div className="flex gap-4">
                        <button
                          onClick={() => toggleGoal(goal)}
                          className={`mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl transition ${
                            checked
                              ? "bg-[#CDE6F3] text-[#235D75] ring-1 ring-[#4D93B4]/35"
                              : "bg-[#D0DFEE] text-[#6B8398] ring-1 ring-[#AFC2D6]/70 hover:text-[#1D2D3C]"
                          }`}
                          aria-label={`Toggle ${goal.title}`}
                        >
                          {checked ? "✓" : "○"}
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <Badge icon={icon}>{goal.category}</Badge>
                                <Badge icon={goal.type === "daily" ? "📅" : "🏁"} tone="blue">
                                  {goal.type === "daily" ? "Daily" : "One-time"}
                                </Badge>
                                {goal.type === "daily" && currentStreak > 0 && (
                                  <Badge icon="🔥" tone="teal">
                                    {currentStreak} day streak
                                  </Badge>
                                )}
                              </div>
                              <h3
                                className={`text-lg font-black ${
                                  checked
                                    ? "text-[#6B8398] line-through decoration-2"
                                    : textMain
                                }`}
                              >
                                {goal.title}
                              </h3>
                              {goal.notes && (
                                <p className={`mt-1 flex items-start gap-1.5 text-sm leading-6 ${textSoft}`}>
                                  <span className="mt-0.5">📍</span> {goal.notes}
                                </p>
                              )}
                              <p className="mt-2 text-xs font-semibold text-[#6B8398]">{secondaryText}</p>
                            </div>

                            <button
                              onClick={() => removeGoal(goal.id)}
                              className="self-start rounded-2xl px-3 py-2 text-[#6B8398] transition hover:bg-[#C96F6F]/10 hover:text-[#9A4B4B]"
                              aria-label={`Delete ${goal.title}`}
                              title="Delete goal"
                            >
                              🗑️
                            </button>
                          </div>

                          <div className="mt-4">
                            <div className={`mb-2 flex items-center justify-between text-xs font-bold ${textSoft}`}>
                              <span>{goal.type === "daily" ? "Progress toward 70% target" : "Goal completion"}</span>
                              <span>{percent}%</span>
                            </div>
                            <div className="h-3 overflow-hidden rounded-full bg-[#C3D6E8]">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-[#6EA8D9] via-[#4F83B6] to-[#2F6F9F] transition-all duration-500"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}

                {filteredGoals.length === 0 && (
                  <div className="rounded-3xl border border-dashed border-[#AFC2D6] bg-[#E7F0F8]/48 p-10 text-center">
                    <div className="mb-3 text-4xl">🎯</div>
                    <h3 className={`font-bold ${textMain}`}>No goals here yet</h3>
                    <p className={`mt-1 text-sm ${textSoft}`}>Add a goal or switch filters to see the rest.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <ProgressPanel
                title="Daily goal target"
                value={Math.round(DAILY_GOAL_TARGET_RATE * 100)}
                description="Daily goals count as successful at 70% completion."
              />
              <ProgressPanel
                title="Projected success"
                value={goals.length ? Math.round((seasonStats.projectedSuccessfulGoals / goals.length) * 100) : 0}
                description="How many goals you’re likely to finish successfully."
              />
            </div>

            <button
              onClick={resetAllData}
              className="w-full rounded-2xl border border-[#AFC2D6]/80 bg-[#E7F0F8]/72 px-4 py-3 text-sm font-bold text-[#4F657A] transition hover:border-[#C96F6F]/40 hover:bg-[#C96F6F]/10 hover:text-[#9A4B4B]"
            >
              Reset demo data
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function handleLogin(event) {
    event.preventDefault();
    setSending(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Check your email for the private login link.");
    }

    setSending(false);
  }

  return (
    <div className="min-h-screen overflow-hidden bg-gradient-to-br from-[#DCEAF7] via-[#CBDDF0] to-[#B8D0E6] p-4 text-[#1D2D3C] sm:p-6 lg:p-8">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-[-8rem] top-[-7rem] h-96 w-96 rounded-full bg-[#F7FBFF]/65 blur-3xl" />
        <div className="absolute right-[-8rem] top-[4rem] h-[28rem] w-[28rem] rounded-full bg-[#6EA8D9]/24 blur-3xl" />
      </div>

      <div className={`mx-auto mt-20 max-w-md rounded-[2rem] p-6 ${surface}`}>
        <Badge icon="🌊" tone="blue">Summer Goals</Badge>
        <h1 className="mt-4 text-3xl font-black text-[#1D2D3C]">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-[#4F657A]">
          Enter your email and Supabase will send you a private login link. Use the same email on your computer and phone to sync your goals.
        </p>

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-[#4F657A]">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className={`w-full rounded-2xl border border-[#AFC2D6] bg-[#EFF6FC]/82 px-4 py-3 text-[#1D2D3C] outline-none transition placeholder:text-[#7390A8] ${focusRing}`}
            />
          </label>

          <button
            type="submit"
            disabled={sending}
            className="w-full rounded-2xl bg-[#376996] px-5 py-3 font-black text-[#F3F8FC] shadow-lg shadow-[#21415F]/18 ring-1 ring-[#2D5D86]/45 transition hover:bg-[#2F5D87] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? "Sending..." : "Send login link"}
          </button>

          {message && (
            <p className="rounded-2xl border border-[#5D86B3]/30 bg-[#5D86B3]/12 p-3 text-sm font-semibold text-[#2F5D87]">
              {message}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

function LoadingScreen({ message }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#DCEAF7] via-[#CBDDF0] to-[#B8D0E6] p-6 text-[#1D2D3C]">
      <div className={`mx-auto mt-24 max-w-md rounded-[2rem] p-6 text-center ${surface}`}>
        <div className="text-4xl">🌊</div>
        <p className="mt-3 font-bold text-[#1D2D3C]">{message}</p>
      </div>
    </div>
  );
}

function DateField({ label, value, onChange }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-[#4F657A]">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-[#AFC2D6] bg-[#EFF6FC]/82 px-3 py-2 text-[#1D2D3C] outline-none focus:border-[#5D86B3] focus:ring-2 focus:ring-[#5D86B3]/20"
      />
    </label>
  );
}

function Badge({ icon, children, tone = "slate" }) {
  const tones = {
    slate: "border border-[#AFC2D6]/70 bg-[#D9E7F5]/68 text-[#41576B]",
    blue: "border border-[#5D86B3]/30 bg-[#5D86B3]/12 text-[#2F5D87]",
    teal: "border border-[#4D93B4]/32 bg-[#4D93B4]/12 text-[#235D75]",
    red: "border border-[#C96F6F]/34 bg-[#C96F6F]/10 text-[#9A4B4B]",
  };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${tones[tone] ?? tones.slate}`}>
      <span>{icon}</span> {children}
    </span>
  );
}

function StatCard({ icon, label, value, subtext }) {
  return (
    <div className={`rounded-[1.75rem] p-5 ${surface}`}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#D0DFEE] text-2xl text-[#2F5D87] ring-1 ring-[#AFC2D6]/70">
        {icon}
      </div>
      <div className="text-sm font-bold uppercase tracking-wide text-[#6B8398]">{label}</div>
      <div className="mt-1 text-3xl font-black text-[#1D2D3C]">{value}</div>
      <div className="mt-1 text-sm text-[#4F657A]">{subtext}</div>
    </div>
  );
}

function ProgressPanel({ title, value, description }) {
  return (
    <div className={`rounded-[1.75rem] p-5 text-[#1D2D3C] ${surface}`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-[#1D2D3C]">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-[#4F657A]">{description}</p>
        </div>
        <div className="text-3xl font-black text-[#2F5D87]">{value}%</div>
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-[#C3D6E8]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#6EA8D9] to-[#2F6F9F] transition-all duration-500"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function ProgressBar({ label, value, muted = false }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm font-bold text-[#41576B]">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-4 overflow-hidden rounded-full bg-[#C3D6E8]">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            muted ? "bg-[#91A9BF]/78" : "bg-gradient-to-r from-[#6EA8D9] via-[#4F83B6] to-[#2F6F9F]"
          }`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function ProjectionRow({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-[#F2F7FC]/18 bg-[#F2F7FC]/12 px-4 py-3">
      <span className="text-sm text-[#D6E5F3]">{label}</span>
      <span className="font-bold text-[#F2F7FC]">{value}</span>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-[#AFC2D6]/70 bg-[#EAF3FA]/66 p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-[#6B8398]">{label}</div>
      <div className="mt-1 text-xl font-black text-[#1D2D3C]">{value}</div>
    </div>
  );
}
