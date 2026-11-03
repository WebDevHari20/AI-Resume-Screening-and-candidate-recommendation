import type { Parsed } from "./nlp.ts";

export interface ProofResult {
  /** null => component excluded from scoring and weights are renormalized */
  score: number | null;
  status: "verified" | "partial" | "unverifiable" | "no_links" | "not_applicable" | "profile_not_found";
  github?: Record<string, unknown> | { error: string };
  leetcode?: Record<string, unknown> | { error: string };
  claims: { verified: string[]; unverified: string[] };
  notes: string[];
}

const DAY = 86_400_000;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Skills we can reasonably check against public repository evidence.
const CHECKABLE = new Set([
  "python", "javascript", "typescript", "java", "c++", "c#", "go", "rust", "php", "ruby",
  "kotlin", "swift", "html", "css", "react", "angular", "vue", "next.js", "node.js", "express",
  "django", "flask", "fastapi", "spring boot", "tailwind", "docker", "pytorch", "tensorflow",
  "pandas", "numpy", "supabase", "firebase",
]);

class Unavailable extends Error {}
class NotFound extends Error {}

async function gh(path: string) {
  const token = Deno.env.get("GITHUB_TOKEN");
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "smart-resume-screening",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 404) throw new NotFound();
  if (res.status === 403 || res.status === 429 || res.status >= 500) throw new Unavailable(`GitHub ${res.status}`);
  if (!res.ok) throw new Unavailable(`GitHub ${res.status}`);
  return res.json();
}

async function checkGithub(username: string) {
  const [user, repos, events] = await Promise.all([
    gh(`/users/${username}`),
    gh(`/users/${username}/repos?per_page=100&type=owner&sort=pushed`),
    gh(`/users/${username}/events/public?per_page=100`).catch(() => []),
  ]);
  const now = Date.now();
  const repoList = Array.isArray(repos) ? repos : [];
  const own = repoList.filter((r) => !r.fork);
  const activeRepos12m = own.filter((r) => now - Date.parse(r.pushed_at) < 365 * DAY).length;
  const stars = own.reduce((n, r) => n + (r.stargazers_count ?? 0), 0);
  const forks = own.reduce((n, r) => n + (r.forks_count ?? 0), 0);

  let commits90 = 0;
  const days30 = new Set<string>(), days90 = new Set<string>();
  const eventList = Array.isArray(events) ? events : [];
  for (const e of eventList) {
    if (e.type !== "PushEvent") continue;
    const age = now - Date.parse(e.created_at);
    const day = e.created_at.slice(0, 10);
    if (age < 90 * DAY) { commits90 += e.payload?.size ?? 0; days90.add(day); }
    if (age < 30 * DAY) days30.add(day);
  }

  const evidence = new Set<string>();
  const languages = new Set<string>();
  for (const r of own) {
    if (r.language) { languages.add(r.language); evidence.add(r.language.toLowerCase()); }
    for (const t of r.topics ?? []) evidence.add(String(t).toLowerCase());
    evidence.add(String(r.name).toLowerCase());
    if (r.description) evidence.add(String(r.description).toLowerCase());
  }

  const score = clamp01(
    0.25 * clamp01(own.length / 8) +
    0.30 * clamp01(commits90 / 30) +
    0.15 * clamp01(days90.size / 15) +
    0.15 * clamp01(activeRepos12m / 4) +
    0.15 * clamp01(stars / 20),
  );

  return {
    score,
    evidence,
    summary: {
      username, profile_url: user.html_url, public_repos: user.public_repos,
      own_repos: own.length, non_fork_repos: own.length, commits_90d: commits90,
      active_days_30d: days30.size, active_days_90d: days90.size,
      active_repos_12m: activeRepos12m, stars, forks, languages: [...languages],
      note: "Commit/active-day counts come from GitHub's public events feed (max ~90 days, ~100 events).",
    },
  };
}

async function checkLeetcode(username: string) {
  const res = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Referer: "https://leetcode.com", "User-Agent": "smart-resume-screening" },
    body: JSON.stringify({
      query: `query u($username:String!){
        matchedUser(username:$username){ submitStats{ acSubmissionNum{ difficulty count } } }
        userContestRanking(username:$username){ rating attendedContestsCount globalRanking }
      }`,
      variables: { username },
    }),
  });
  if (!res.ok) throw new Unavailable(`LeetCode ${res.status}`);
  const body = await res.json();
  const mu = body?.data?.matchedUser;
  if (!mu) {
    if (!body?.data && body?.errors) throw new Unavailable("LeetCode response format changed");
    throw new NotFound();
  }
  const by = Object.fromEntries(
    (mu.submitStats?.acSubmissionNum ?? []).map((x: any) => [x.difficulty.toLowerCase(), x.count]),
  );
  const total = by.all ?? 0, easy = by.easy ?? 0, medium = by.medium ?? 0, hard = by.hard ?? 0;
  const contest = body.data.userContestRanking;
  const score = clamp01(
    0.6 * clamp01(total / 200) + 0.3 * clamp01((medium + hard) / 80) + (contest?.attendedContestsCount ? 0.1 : 0),
  );
  return {
    score,
    total,
    summary: {
      username, total_solved: total, easy, medium, hard,
      contest_rating: contest?.rating ?? null,
      contests_attended: contest?.attendedContestsCount ?? 0,
      global_ranking: contest?.globalRanking ?? null,
    },
  };
}

export async function verifyProof(
  parsed: Parsed,
  job: { requires_proof_of_work: boolean },
): Promise<ProofResult> {
  const out: ProofResult = { score: null, status: "not_applicable", claims: { verified: [], unverified: [] }, notes: [] };
  const hasLinks = !!(parsed.github || parsed.leetcode);

  if (!hasLinks) {
    if (job.requires_proof_of_work) {
      return { ...out, score: 0, status: "no_links", notes: ["Proof of work is required but no GitHub or LeetCode link was found."] };
    }
    return { ...out, notes: ["No public profile links; proof of work not applicable for this job."] };
  }
  if (Deno.env.get("ENABLE_EXTERNAL_VERIFICATION") === "false") {
    return { ...out, status: "unverifiable", notes: ["External verification is disabled."] };
  }

  const parts: { score: number; weight: number }[] = [];
  let evidence = new Set<string>();
  let lcTotal: number | null = null;
  let unavailable = 0, notFound = 0, tried = 0;

  if (parsed.github) {
    tried++;
    try {
      const r = await checkGithub(parsed.github);
      parts.push({ score: r.score, weight: 0.65 });
      evidence = r.evidence;
      out.github = r.summary;
    } catch (e) {
      if (e instanceof NotFound) { notFound++; out.github = { error: "profile not found" }; }
      else { unavailable++; out.github = { error: (e as Error).message }; }
    }
  }
  if (parsed.leetcode) {
    tried++;
    try {
      const r = await checkLeetcode(parsed.leetcode);
      parts.push({ score: r.score, weight: 0.35 });
      lcTotal = r.total;
      out.leetcode = r.summary;
    } catch (e) {
      if (e instanceof NotFound) { notFound++; out.leetcode = { error: "profile not found" }; }
      else { unavailable++; out.leetcode = { error: (e as Error).message }; }
    }
  }

  if (!parts.length) {
    if (unavailable > 0) {
      out.status = "unverifiable";
      out.notes.push("Verification service unavailable; proof of work excluded from the score instead of counted as zero.");
    } else {
      out.status = "profile_not_found";
      out.score = 0;
      out.notes.push("Linked public profile(s) could not be found.");
    }
    return out;
  }

  const wsum = parts.reduce((n, p) => n + p.weight, 0);
  let score = parts.reduce((n, p) => n + p.score * p.weight, 0) / wsum;

  // Claim verification
  for (const skill of parsed.skills) {
    if (CHECKABLE.has(skill) && evidence.size) {
      const needle = skill === "go" ? "go" : skill;
      const hit = [...evidence].some((e) => e === needle || (needle.length > 3 && e.includes(needle)));
      (hit ? out.claims.verified : out.claims.unverified).push(skill);
    }
  }
  if (lcTotal !== null && (parsed.skills.includes("data structures") || parsed.skills.includes("algorithms"))) {
    (lcTotal >= 50 ? out.claims.verified : out.claims.unverified).push("data structures / algorithms");
  }
  const checked = out.claims.verified.length + out.claims.unverified.length;
  if (checked > 0) score *= 0.7 + 0.3 * (out.claims.verified.length / checked);

  out.score = clamp01(score);
  out.status = tried === parts.length ? "verified" : "partial";
  if (unavailable > 0 || notFound > 0) out.notes.push("Some linked profiles could not be checked.");
  out.notes.push("Public activity is supporting evidence only; it cannot prove account ownership or overall ability.");
  return out;
}
