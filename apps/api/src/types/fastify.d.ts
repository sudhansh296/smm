import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      isAdmin: boolean;
    };
    user: {
      sub: string;
      isAdmin: boolean;
    };
  }
}
