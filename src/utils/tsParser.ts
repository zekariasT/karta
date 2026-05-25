import { Project, SourceFile } from "ts-morph";

export function createProject(): Project {
  return new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: false,
      skipLibCheck: true,
    },
  });
}

export function safeAddSourceFile(
  project: Project,
  absPath: string
): SourceFile | null {
  try {
    return project.addSourceFileAtPath(absPath);
  } catch {
    return null;
  }
}
