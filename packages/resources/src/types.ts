export type SkillSource = "builtin" | "user" | "project";

export type SkillInvocation = "model" | "explicit-only";

export interface ResourceDiagnostic {
  readonly code:
    | "catalog_limit"
    | "collision"
    | "invalid_metadata"
    | "io_error"
    | "size_limit";
  readonly source: SkillSource;
  readonly sourcePath: string;
  readonly message: string;
}

export interface SkillFileIdentity {
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly modifiedMs: number;
}

export interface SkillDescriptor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly source: SkillSource;
  readonly root: string;
  readonly canonicalPath: string;
  readonly baseDirectory: string;
  readonly contentSize: number;
  readonly invocation: SkillInvocation;
  readonly modelInvocationEnabled: boolean;
  readonly disabledBy?: "user";
  readonly identity: SkillFileIdentity;
  readonly diagnostics: readonly ResourceDiagnostic[];
  readonly shadowedSources: readonly SkillSource[];
}

export interface SkillCatalog {
  readonly skills: readonly SkillDescriptor[];
  readonly resources: readonly SkillDescriptor[];
  readonly diagnostics: readonly ResourceDiagnostic[];
  readonly prompt: string;
}

export interface SkillSelection {
  readonly skill: SkillDescriptor;
  readonly reason: "automatic" | "explicit";
}

export interface LoadedSkillResource {
  readonly id: string;
  readonly skillId: string;
  readonly name: string;
  readonly source: SkillSource;
  readonly invocation: SkillInvocation;
  readonly baseDirectory: string;
  readonly relativePath: string;
  readonly content: string;
  readonly truncated: boolean;
  readonly resources: readonly {
    readonly id: string;
    readonly relativePath: string;
  }[];
}
