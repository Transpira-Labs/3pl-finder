// Frozen API shapes from the locked pipeline design (§5). The routes are built
// in parallel — these mirror the contract the frontend codes against.

export type Stage =
  | "new"
  | "contacted"
  | "follow_up"
  | "qualified"
  | "won"
  | "lost"
  | "do_not_contact";

export type ActivityKind = "outcome" | "note" | "stage_change" | "followup" | "system";

export type Activity = {
  id: string;
  leadId: string;
  callAttemptId: string | null;
  repId: string | null;
  kind: ActivityKind;
  templateKey: string | null;
  body: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

export type FollowUpChannel = "call" | "email";
export type FollowUpStatus = "pending" | "done" | "canceled";

export type FollowUp = {
  id: string;
  leadId: string;
  campaignId: string | null;
  repId: string | null;
  channel: FollowUpChannel;
  dueAt: string;
  note: string | null;
  status: FollowUpStatus;
  createdAt: string;
  completedAt: string | null;
};

export type CallAttemptSummary = {
  id: string;
  finalState: string | null;
  disposition: string | null;
  startedAt: string;
  endedAt: string | null;
  reachedHuman: boolean;
  bridged: boolean;
};

/** Common lead fields shared by list rows and the detail payload. */
export type LeadBase = {
  id: string;
  name: string | null;
  company: string | null;
  phone: string;
  timezone: string | null;
  pipelineStage: Stage;
  lastContacted: string | null;
  createdAt: string;
  campaignId: string | null;
};

export type PipelineLead = LeadBase & {
  nextFollowUp: FollowUp | null;
  lastActivity: Activity | null;
};

export type PipelineSummary = {
  stages: Record<Stage, number>;
  dueNow: number;
};

export type LeadsResponse = {
  leads: PipelineLead[];
  total: number;
  summary: PipelineSummary;
};

export type LeadDetailResponse = {
  lead: LeadBase;
  activities: Activity[];
  followUps: FollowUp[];
  callAttempts: CallAttemptSummary[];
};

export type FollowUpRow = FollowUp & {
  lead: { id: string; name: string | null; company: string | null; phone: string; pipelineStage: Stage };
};

export type FollowUpsResponse = {
  followUps: FollowUpRow[];
  total: number;
};
