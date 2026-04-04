"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Project {
  id: string;
  name: string;
  path: string;
  gitUrl: string | null;
  branch: string;
  remoteUrl: string;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  labels: Array<{ name: string; color: string }>;
  milestone: {
    id: number;
    number: number;
    title: string;
  } | null;
  assignee: {
    login: string;
    avatar_url: string;
  } | null;
  created_at: string;
  updated_at: string;
}

interface GitHubMilestone {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  description: string | null;
  html_url: string;
  open_issues: number;
  closed_issues: number;
  due_on: string | null;
}

interface MilestoneGroup {
  milestone: GitHubMilestone;
  issues: GitHubIssue[];
}

interface IssuesData {
  owner: string;
  repo: string;
  milestones: MilestoneGroup[];
  unassigned: GitHubIssue[];
}

interface ProjectIssues {
  project: Project;
  data: IssuesData | null;
  loading: boolean;
  error: string | null;
}

interface ProjectPanelProps {
  projectIssues: ProjectIssues;
  isExpanded: boolean;
  onToggle: () => void;
  onAddToQueue?: (issue: GitHubIssue, repoOwner: string, repoName: string) => void;
  addingIssueId?: number | null;
}

function ProjectPanel({
  projectIssues,
  isExpanded,
  onToggle,
  onAddToQueue,
  addingIssueId,
}: ProjectPanelProps) {
  const { project, data, loading, error } = projectIssues;
  const totalIssues = data
    ? data.milestones.reduce((sum, m) => sum + m.issues.length, 0) + data.unassigned.length
    : 0;

  return (
    <div className="card" style={{ border: "1px solid rgba(30,45,74,0.8)" }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        style={{ background: "transparent" }}
      >
        <div className="flex items-center gap-3">
          <svg
            className="w-4 h-4 transition-transform"
            style={{
              transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
              color: "#94a3b8",
            }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="font-semibold text-sm" style={{ color: "#e2e8f0" }}>
            {project.name || project.path.split("/").pop()}
          </span>
          {project.branch && (
            <span
              className="text-xs px-2 py-0.5 rounded font-mono"
              style={{
                background: "rgba(0,212,255,0.1)",
                color: "#00d4ff",
                border: "1px solid rgba(0,212,255,0.2)",
              }}
            >
              {project.branch}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="text-xs" style={{ color: "#4a5568" }}>
              Loading...
            </span>
          )}
          {error && (
            <span className="text-xs" style={{ color: "#ff4444" }}>
              Error
            </span>
          )}
          {!loading && !error && data && (
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{
                background: totalIssues > 0 ? "rgba(168,85,247,0.1)" : "rgba(30,45,74,0.3)",
                color: totalIssues > 0 ? "#a855f7" : "#4a5568",
                border: `1px solid ${totalIssues > 0 ? "rgba(168,85,247,0.2)" : "rgba(30,45,74,0.5)"}`,
              }}
            >
              {totalIssues} issue{totalIssues !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          {error && (
            <div
              className="text-xs px-3 py-2 rounded"
              style={{ background: "rgba(255,68,68,0.1)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.2)" }}
            >
              {error}
            </div>
          )}

          {loading && !data && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse h-8 rounded" style={{ background: "rgba(30,45,74,0.3)" }} />
              ))}
            </div>
          )}

          {data && (
            <>
              {data.milestones.map((mg) => (
                <MilestoneSection
                  key={mg.milestone.id}
                  milestoneGroup={mg}
                  repoOwner={data.owner}
                  repoName={data.repo}
                  onAddToQueue={onAddToQueue}
                  addingIssueId={addingIssueId}
                />
              ))}

              {data.unassigned.length > 0 && (
                <MilestoneSection
                  milestoneGroup={{
                    milestone: {
                      id: 0,
                      number: 0,
                      title: "No Milestone",
                      state: "open",
                      description: null,
                      html_url: "",
                      open_issues: data.unassigned.length,
                      closed_issues: 0,
                      due_on: null,
                    },
                    issues: data.unassigned,
                  }}
                  repoOwner={data.owner}
                  repoName={data.repo}
                  onAddToQueue={onAddToQueue}
                  addingIssueId={addingIssueId}
                />
              )}

              {totalIssues === 0 && (
                <div className="text-xs text-center py-4" style={{ color: "#4a5568" }}>
                  No open issues
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface MilestoneSectionProps {
  milestoneGroup: MilestoneGroup;
  repoOwner: string;
  repoName: string;
  onAddToQueue?: (issue: GitHubIssue, repoOwner: string, repoName: string) => void;
  addingIssueId?: number | null;
}

function MilestoneSection({ milestoneGroup, repoOwner, repoName, onAddToQueue, addingIssueId }: MilestoneSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const { milestone, issues } = milestoneGroup;

  return (
    <div className="rounded overflow-hidden" style={{ border: "1px solid rgba(30,45,74,0.5)" }}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2"
        style={{ background: "rgba(30,45,74,0.3)" }}
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-3 h-3 transition-transform"
            style={{
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              color: "#94a3b8",
            }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="text-xs font-semibold" style={{ color: "#a855f7" }}>
            {milestone.title}
          </span>
          {milestone.due_on && (
            <span className="text-xs" style={{ color: "#4a5568" }}>
              due {new Date(milestone.due_on).toLocaleDateString()}
            </span>
          )}
        </div>
        <span
          className="text-xs px-1.5 py-0.5 rounded"
          style={{
            background: "rgba(168,85,247,0.15)",
            color: "#a855f7",
          }}
        >
          {issues.length}
        </span>
      </button>

      {expanded && (
        <div className="space-y-1 p-2">
          {issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              repoOwner={repoOwner}
              repoName={repoName}
              onAddToQueue={onAddToQueue}
              adding={addingIssueId === issue.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface IssueRowProps {
  issue: GitHubIssue;
  repoOwner: string;
  repoName: string;
  onAddToQueue?: (issue: GitHubIssue, repoOwner: string, repoName: string) => void;
  adding?: boolean;
}

function IssueRow({ issue, repoOwner, repoName, onAddToQueue, adding }: IssueRowProps) {
  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded transition-colors hover:bg-white/5 group">
      <a
        href={issue.html_url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-2 flex-1 min-w-0"
      >
        <span
          className="text-xs font-mono flex-shrink-0"
          style={{ color: "#ffd700" }}
        >
          #{issue.number}
        </span>
        <span className="text-xs flex-1 line-clamp-2" style={{ color: "#e2e8f0" }}>
          {issue.title}
        </span>
        {issue.labels.length > 0 && (
          <div className="flex gap-1 flex-shrink-0">
            {issue.labels.slice(0, 2).map((label) => (
              <span
                key={label.name}
                className="text-xs px-1.5 py-0.5 rounded"
                style={{
                  background: `#${label.color}20`,
                  color: `#${label.color}`,
                  border: `1px solid #${label.color}40`,
                }}
              >
                {label.name}
              </span>
            ))}
            {issue.labels.length > 2 && (
              <span className="text-xs" style={{ color: "#4a5568" }}>
                +{issue.labels.length - 2}
              </span>
            )}
          </div>
        )}
      </a>
      {onAddToQueue && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onAddToQueue(issue, repoOwner, repoName);
          }}
          disabled={adding}
          className="text-xs px-2 py-1 rounded flex-shrink-0 transition-opacity opacity-0 group-hover:opacity-100 disabled:opacity-50"
          style={{
            background: "rgba(0,255,136,0.1)",
            color: "#00ff88",
            border: "1px solid rgba(0,255,136,0.25)",
            cursor: adding ? "wait" : "pointer",
          }}
        >
          {adding ? "Adding..." : "+ Queue"}
        </button>
      )}
    </div>
  );
}

interface IssuesPanelProps {
  refreshToken?: number;
  onAddToQueue?: (issue: GitHubIssue, repoOwner: string, repoName: string) => void;
  addingIssueId?: number | null;
}

export default function IssuesPanel({ refreshToken, onAddToQueue, addingIssueId }: IssuesPanelProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [issuesData, setIssuesData] = useState<Map<string, ProjectIssues>>(new Map());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      const data = await res.json();
      const projectList = (data.projects || []) as Project[];
      setProjects(projectList.filter((p) => p.gitUrl || p.remoteUrl));
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const fetchIssuesForProject = useCallback(async (project: Project) => {
    const url = project.gitUrl || project.remoteUrl;
    if (!url) return;

    setIssuesData((prev) => {
      const next = new Map(prev);
      const existing = next.get(project.id);
      if (existing) {
        next.set(project.id, { ...existing, loading: true, error: null });
      } else {
        next.set(project.id, {
          project,
          data: null,
          loading: true,
          error: null,
        });
      }
      return next;
    });

    try {
      const res = await fetch(`/api/github/issues?url=${encodeURIComponent(url)}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to fetch issues");
      }
      const data = await res.json();

      setIssuesData((prev) => {
        const next = new Map(prev);
        next.set(project.id, {
          project,
          data,
          loading: false,
          error: null,
        });
        return next;
      });
    } catch (err) {
      setIssuesData((prev) => {
        const next = new Map(prev);
        next.set(project.id, {
          project,
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load issues",
        });
        return next;
      });
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects, refreshToken]);

  useEffect(() => {
    if (projects.length > 0) {
      setExpandedProjects(new Set([projects[0].id]));
    }
  }, [projects]);

  useEffect(() => {
    for (const project of projects) {
      const existing = issuesData.get(project.id);
      if (!existing || (!existing.loading && !existing.data && !existing.error)) {
        fetchIssuesForProject(project);
        break;
      }
    }
  }, [projects, issuesData, fetchIssuesForProject]);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      for (const project of projects) {
        fetchIssuesForProject(project);
      }
    }, 60000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [projects, fetchIssuesForProject]);

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold" style={{ color: "#a855f7" }}>
          Git Issues
        </h2>
        <span className="text-xs" style={{ color: "#4a5568" }}>
          {projects.length} project{projects.length !== 1 ? "s" : ""}
        </span>
      </div>

      {projectsLoading && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="card animate-pulse" style={{ height: 60 }} />
          ))}
        </div>
      )}

      {projectsError && (
        <div
          className="card flex items-center justify-center py-8"
          style={{ color: "#ff4444" }}
        >
          {projectsError}
        </div>
      )}

      {!projectsLoading && !projectsError && projects.length === 0 && (
        <div
          className="card flex flex-col items-center justify-center py-8 gap-2"
          style={{ color: "#4a5568" }}
        >
          <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
          </svg>
          <span className="text-sm">No projects with GitHub remotes</span>
        </div>
      )}

      {!projectsLoading &&
        !projectsError &&
        projects.map((project) => (
          <ProjectPanel
            key={project.id}
            projectIssues={issuesData.get(project.id) || {
              project,
              data: null,
              loading: !issuesData.has(project.id),
              error: null,
            }}
            isExpanded={expandedProjects.has(project.id)}
            onToggle={() => toggleProject(project.id)}
            onAddToQueue={onAddToQueue}
            addingIssueId={addingIssueId}
          />
        ))}
    </div>
  );
}