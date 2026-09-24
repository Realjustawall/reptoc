declare module 'otplib' {
  export const authenticator: {
    generateSecret: () => string;
    keyuri: (user: string, service: string, secret: string) => string;
    check: (token: string, secret: string) => boolean;
    verify: (opts: { token: string; secret: string }) => boolean;
  };
}
