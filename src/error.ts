export class DavenportError extends Error {
  constructor(
    message: string,
    public fullResponse: Response,
    public body: any,
  ) {
    super(message);

    this.status = fullResponse.status;
    this.statusText = fullResponse.statusText;
    this.url = fullResponse.url;
  }

  public readonly isDavenport = true;

  public status: number;

  public statusText: string;

  public url: string;
}

export function isDavenportError(error: any): error is DavenportError {
  return !!error && error.isDavenport === true;
}
