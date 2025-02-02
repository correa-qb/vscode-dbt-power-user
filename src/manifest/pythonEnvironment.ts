import { Disposable, Event, extensions, Uri, workspace } from "vscode";
import { EnvironmentVariables } from "../domain";
import { provideSingleton, substituteSettingsVariables } from "../utils";

interface PythonExecutionDetails {
  getPythonPath: () => string;
  onDidChangeExecutionDetails: Event<Uri | undefined>;
  getEnvVars: () => EnvironmentVariables;
}

@provideSingleton(PythonEnvironment)
export class PythonEnvironment implements Disposable {
  private executionDetails?: PythonExecutionDetails;
  private disposables: Disposable[] = [];

  dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  public get pythonPath() {
    return (
      this.getPythonPathFromConfig() || this.executionDetails!.getPythonPath()
    );
  }

  public get environmentVariables() {
    return this.executionDetails!.getEnvVars();
  }

  public get onPythonEnvironmentChanged() {
    return this.executionDetails!.onDidChangeExecutionDetails;
  }

  async initialize(): Promise<void> {
    if (this.executionDetails !== undefined) {
      return;
    }

    this.executionDetails = await this.activatePythonExtension();
  }

  private getPythonPathFromConfig(): string | undefined {
    const value = workspace
      .getConfiguration("dbt")
      .get<string>("dbtPythonPathOverride");
    return value ? substituteSettingsVariables(value) : undefined;
  }

  private parseEnvVarsFromUserSettings = (vsCodeEnv: {
    [k: string]: string;
  }) => {
    // TODO: add any other relevant variables, maybe workspacefolder?
    return Object.keys(vsCodeEnv).reduce(
      (prev: { [k: string]: string }, key: string) => {
        prev[key] = substituteSettingsVariables(vsCodeEnv[key]);
        return prev;
      },
      vsCodeEnv
    );
  };

  private async activatePythonExtension(): Promise<PythonExecutionDetails> {
    const extension = extensions.getExtension("ms-python.python")!;

    if (!extension.isActive) {
      await extension.activate();
    }
    await extension.exports.ready;

    const api = extension.exports;

    return (this.executionDetails = {
      getPythonPath: () =>
        api.settings.getExecutionDetails(workspace.workspaceFile)
          .execCommand[0],
      onDidChangeExecutionDetails: api.settings.onDidChangeExecutionDetails,
      getEnvVars: () => {
        const configText = workspace.getConfiguration();
        const config = JSON.parse(JSON.stringify(configText));
        let envVars = {};
        if (
          config.terminal !== undefined &&
          config.terminal.integrated !== undefined &&
          config.terminal.integrated.env !== undefined
        ) {
          const env = config.terminal.integrated.env;
          // parse vs code environment variables
          for (const prop in env) {
            const vsCodeEnv = env[prop];
            envVars = {
              ...process.env,
              ...envVars,
              ...this.parseEnvVarsFromUserSettings(vsCodeEnv),
            };
          }
        }
        try {
          if (api.environment) {
            envVars = {
              ...envVars,
              ...api.environments.getEnvironmentVariables(
                workspace.workspaceFolders![0]
              ),
            };
          }
        } catch (e) {
          console.error("Could not call environment api", e);
        }

        return envVars;
      },
    });
  }
}
