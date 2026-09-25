export interface paths {
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                user: {
                                    id: string;
                                    /** Format: email */
                                    email: string;
                                    name: string;
                                    role: string;
                                    mustChangePassword: boolean;
                                    needsTermsAcceptance: boolean;
                                };
                                accessToken: string;
                                refreshToken: string;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                accessToken: string;
                                refreshToken: string;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** @enum {boolean} */
                                success: true;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: ({
                                id: string;
                                name: string;
                                industry: string | null;
                                /** @enum {string} */
                                periodicity: "MONTHLY" | "BIWEEKLY" | "QUARTERLY" | "CUSTOM_DAYS";
                                /** @enum {string} */
                                condicionIva: "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTO" | "EXENTO";
                            } & {
                                [key: string]: unknown;
                            })[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/cost-structures": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: ({
                                id: string;
                                companyId: string;
                                productName: string;
                                period: string;
                                status: string;
                                /** @enum {string} */
                                costingSystem: "ORDERS" | "PROCESSES";
                            } & {
                                [key: string]: unknown;
                            })[];
                            nextCursor: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/cost-structures/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                id: string;
                                companyId: string;
                                productName: string;
                                period: string;
                                status: string;
                                /** @enum {string} */
                                costingSystem: "ORDERS" | "PROCESSES";
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/cost-structures/{id}/raw-material": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                id: string;
                                companyId: string;
                                productName: string;
                                period: string;
                                status: string;
                                /** @enum {string} */
                                costingSystem: "ORDERS" | "PROCESSES";
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/cost-structures/{id}/direct-labor": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                id: string;
                                companyId: string;
                                productName: string;
                                period: string;
                                status: string;
                                /** @enum {string} */
                                costingSystem: "ORDERS" | "PROCESSES";
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/cost-structures/{id}/indirect-costs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                id: string;
                                companyId: string;
                                productName: string;
                                period: string;
                                status: string;
                                /** @enum {string} */
                                costingSystem: "ORDERS" | "PROCESSES";
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/cost-structures/{id}/calculate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                result: ({
                                    rawMaterialConsumed: number;
                                    directLaborTotal: number;
                                    indirectCostsApplied: number;
                                    productionCost: number;
                                    costOfGoodsSold: number;
                                    grossMargin: number;
                                    grossMarginPct: number;
                                } & {
                                    [key: string]: unknown;
                                }) & {
                                    currency: {
                                        /** @enum {string} */
                                        kind: "NOMINAL" | "HOMOGENEA";
                                        periodCode: string | null;
                                        index: number | null;
                                        seriesVersionId: string | null;
                                        missingPeriodCodes: string[];
                                    };
                                };
                                calculationId: string;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/cost-structures/{id}/simulate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                result: {
                                    rawMaterialConsumed: number;
                                    directLaborTotal: number;
                                    indirectCostsApplied: number;
                                    productionCost: number;
                                    costOfGoodsSold: number;
                                    grossMargin: number;
                                    grossMarginPct: number;
                                } & {
                                    [key: string]: unknown;
                                };
                                /** @enum {boolean} */
                                simulated: true;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/structures/{id}/periods": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: ({
                                id: string;
                                structureId: string;
                                companyId: string;
                                code: string;
                                label: string;
                                /** @enum {string} */
                                status: "OPEN" | "CLOSED";
                            } & {
                                [key: string]: unknown;
                            })[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/structures/{id}/periods/open": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: ({
                                id: string;
                                structureId: string;
                                companyId: string;
                                code: string;
                                label: string;
                                /** @enum {string} */
                                status: "OPEN" | "CLOSED";
                            } & {
                                [key: string]: unknown;
                            }) | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/structures/{id}/periods/compare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                unidadGestion: {
                                    codigo: string;
                                    nombre: string;
                                    factor: number;
                                } | null;
                                units: {
                                    from: number | null;
                                    to: number | null;
                                    comparable: boolean;
                                };
                                currency: {
                                    /** @enum {string} */
                                    kind: "NOMINAL" | "HOMOGENEA";
                                    periodCode: string | null;
                                    index: number | null;
                                    seriesVersionId: string | null;
                                    missingPeriodCodes: string[];
                                };
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/periods/{id}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: ({
                                id: string;
                                structureId: string;
                                companyId: string;
                                code: string;
                                label: string;
                                /** @enum {string} */
                                status: "OPEN" | "CLOSED";
                            } & {
                                [key: string]: unknown;
                            }) | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/periods/{id}/tablero-dueno": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                periodo: {
                                    id: string;
                                    codigo: string;
                                };
                                corrida: {
                                    id: string;
                                    validada: boolean;
                                    ejecutadaEn: string;
                                } | null;
                                unidadGestion: {
                                    codigo: string;
                                    nombre: string;
                                    factor: number;
                                } | null;
                                rubro: {
                                    clave: string;
                                    nombreProducto: string | null;
                                    icons: {
                                        [key: string]: string;
                                    };
                                    kpisHome: {
                                        clave: string;
                                        etiqueta: string;
                                        unidad: string;
                                        valor: number | null;
                                        completo: boolean;
                                    }[];
                                } | null;
                                pendientes: {
                                    /** @enum {string} */
                                    area: "calculo" | "imputacion" | "configuracion" | "produccion" | "ventas" | "costeo";
                                    dato: string;
                                    periodo: {
                                        id: string;
                                        codigo: string;
                                    };
                                }[];
                                costoPorCajon: {
                                    variable: {
                                        valor: number | null;
                                        completo: boolean;
                                        parametrosSinConfirmar: boolean;
                                        parametrosSinConfirmarDetalle: {
                                            id: string;
                                            nombre: string;
                                        }[];
                                        motivos: string[];
                                    };
                                    fijo: {
                                        valor: number | null;
                                        completo: boolean;
                                        parametrosSinConfirmar: boolean;
                                        parametrosSinConfirmarDetalle: {
                                            id: string;
                                            nombre: string;
                                        }[];
                                        motivos: string[];
                                        /** @enum {boolean} */
                                        esUnitarioDeFijo: true;
                                    };
                                    total: {
                                        valor: number | null;
                                        completo: boolean;
                                        parametrosSinConfirmar: boolean;
                                        parametrosSinConfirmarDetalle: {
                                            id: string;
                                            nombre: string;
                                        }[];
                                        motivos: string[];
                                    };
                                };
                                costosFijosDelPeriodo: {
                                    valor: number | null;
                                    completo: boolean;
                                    parametrosSinConfirmar: boolean;
                                    parametrosSinConfirmarDetalle: {
                                        id: string;
                                        nombre: string;
                                    }[];
                                    motivos: string[];
                                };
                                cajonesQueTapanLosFijos: {
                                    valor: number | null;
                                    completo: boolean;
                                    parametrosSinConfirmar: boolean;
                                    parametrosSinConfirmarDetalle: {
                                        id: string;
                                        nombre: string;
                                    }[];
                                    motivos: string[];
                                };
                                precioPromedioVenta: {
                                    valor: number | null;
                                    completo: boolean;
                                    parametrosSinConfirmar: boolean;
                                    parametrosSinConfirmarDetalle: {
                                        id: string;
                                        nombre: string;
                                    }[];
                                    motivos: string[];
                                };
                                contribucionMarginalPorCajon: {
                                    valor: number | null;
                                    completo: boolean;
                                    parametrosSinConfirmar: boolean;
                                    parametrosSinConfirmarDetalle: {
                                        id: string;
                                        nombre: string;
                                    }[];
                                    motivos: string[];
                                };
                                puntoEquilibrioCajones: {
                                    valor: number | null;
                                    completo: boolean;
                                    parametrosSinConfirmar: boolean;
                                    parametrosSinConfirmarDetalle: {
                                        id: string;
                                        nombre: string;
                                    }[];
                                    motivos: string[];
                                    /** @enum {string} */
                                    tipo?: "punto" | "zona";
                                    qMin?: number;
                                    qMax?: number;
                                    conceptosQueLaEnsanchan?: {
                                        clave: string;
                                        etiqueta: string;
                                        importe: number;
                                        aporteAlAncho: number;
                                    }[];
                                    fechaUltimoRecalculo: string | null;
                                };
                                producidoCajones: {
                                    valor: number | null;
                                    completo: boolean;
                                    parametrosSinConfirmar: boolean;
                                    parametrosSinConfirmarDetalle: {
                                        id: string;
                                        nombre: string;
                                    }[];
                                    motivos: string[];
                                };
                                resultadoPeriodo: {
                                    valor: number | null;
                                    completo: boolean;
                                    parametrosSinConfirmar: boolean;
                                    parametrosSinConfirmarDetalle: {
                                        id: string;
                                        nombre: string;
                                    }[];
                                    motivos: string[];
                                };
                                resultadoPeriodoCosteoVariable: {
                                    valor: number | null;
                                    completo: boolean;
                                    parametrosSinConfirmar: boolean;
                                    parametrosSinConfirmarDetalle: {
                                        id: string;
                                        nombre: string;
                                    }[];
                                    motivos: string[];
                                };
                                diferenciaPorVariacionDeInventarios: {
                                    valor: number | null;
                                    completo: boolean;
                                    parametrosSinConfirmar: boolean;
                                    parametrosSinConfirmarDetalle: {
                                        id: string;
                                        nombre: string;
                                    }[];
                                    motivos: string[];
                                    explicacion: string | null;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/datos/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                id: string;
                                status: string;
                                /** @enum {boolean} */
                                isDuplicate: true;
                                message: string;
                            } | {
                                id: string;
                                status: string;
                                /** @enum {boolean} */
                                isDuplicate: false;
                                classification: {
                                    documentType: string;
                                    costSection: string;
                                    confidence: number;
                                } & {
                                    [key: string]: unknown;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                id: string;
                                status: string;
                                /** @enum {boolean} */
                                isDuplicate: true;
                                message: string;
                            } | {
                                id: string;
                                status: string;
                                /** @enum {boolean} */
                                isDuplicate: false;
                                classification: {
                                    documentType: string;
                                    costSection: string;
                                    confidence: number;
                                } & {
                                    [key: string]: unknown;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/validaciones/pending": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                items: ({
                                    id: string;
                                    /** @enum {string} */
                                    status: "PENDING" | "APPROVED" | "REJECTED" | "CORRECTED";
                                    rawContent: string;
                                    sourceType: string;
                                } & {
                                    [key: string]: unknown;
                                })[];
                                total: number;
                                page: number;
                                limit: number;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/validaciones/{entryId}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    entryId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                id: string;
                                /** @enum {string} */
                                status: "PENDING" | "APPROVED" | "REJECTED" | "CORRECTED";
                                rawContent: string;
                                sourceType: string;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/telemetria-panel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        tipo: "ACCION_TOCADA";
                        accion: string;
                    } | {
                        /** @enum {string} */
                        tipo: "CARGA_INICIADA";
                        accion: string;
                    } | {
                        /** @enum {string} */
                        tipo: "CARGA_ABANDONADA";
                        accion: string;
                        duracionMs: number;
                    } | {
                        /** @enum {string} */
                        tipo: "CARGA_COMPLETADA";
                        accion: string;
                        duracionMs: number;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                id: string;
                                /** @enum {string} */
                                tipo: "ACCION_TOCADA" | "CARGA_INICIADA" | "CARGA_ABANDONADA" | "CARGA_COMPLETADA";
                                accion: string;
                                duracionMs: number | null;
                                rolTecnico: string;
                                /** Format: date-time */
                                registradoEn: string;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/price-index-series": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                companyId: string;
                                source: string;
                                basePeriodCode: string;
                                version: {
                                    /** Format: uuid */
                                    id: string;
                                    number: number;
                                    /** Format: date-time */
                                    createdAt: string;
                                };
                                values: {
                                    periodCode: string;
                                    indexValue: number;
                                }[];
                            } | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                companyId: string;
                                source: string;
                                basePeriodCode: string;
                                version: {
                                    /** Format: uuid */
                                    id: string;
                                    number: number;
                                    /** Format: date-time */
                                    createdAt: string;
                                };
                                values: {
                                    periodCode: string;
                                    indexValue: number;
                                }[];
                            } | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/modulos-rubro": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                clave: string;
                                nombre: string;
                                descripcion: string;
                                /** @enum {string} */
                                estado: "prendido" | "apagado";
                                porDefecto: boolean;
                                dependeDe: string[];
                                superficies: string[];
                                parametros: {
                                    clave: string;
                                    descripcion: string;
                                    opciones?: {
                                        valor: string;
                                        etiqueta: string;
                                    }[];
                                }[];
                                alertas: string[];
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/indicadores-macro": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                clave: string;
                                etiqueta: string;
                                valor: number | null;
                                unidad: string | null;
                                /** Format: date-time */
                                fecha: string | null;
                                fuenteNombre: string;
                                /** Format: uri */
                                fuenteUrl: string;
                                /** @enum {string} */
                                error?: "fuente no disponible";
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/conceptos-costeo/{id}/importes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                conceptoId: string;
                                importeFijo: number | null;
                                importeVariableUnitario: number | null;
                                moneda: string;
                                unidad: string;
                                /** Format: date-time */
                                vigenteDesde: string;
                                /** Format: date-time */
                                createdAt: string;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/analisis/punto-cierre": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                moneda: string | null;
                                unidad: string | null;
                                /** @enum {boolean} */
                                nominal: true;
                                precioUnitario: number;
                                puntoEquilibrioEconomico: number;
                                actividad: number | null;
                                importeVersionIds: string[];
                                horizontes: {
                                    horizonteMeses: number;
                                    valor: number | null;
                                    motivoSinEquilibrio?: string;
                                    costosFijosErogables: number | null;
                                    costoVariableUnitarioErogable: number | null;
                                    contribucionMarginalFinanciera: number | null;
                                    situacion: string | null;
                                    advertencia: string;
                                    basadoEn: {
                                        clave: string;
                                        etiqueta: string;
                                    }[];
                                    conceptosIncluidos?: {
                                        clave: string;
                                        etiqueta: string;
                                    }[];
                                    conceptosExcluidos?: {
                                        clave: string;
                                        etiqueta: string;
                                    }[];
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/tramos-costo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                conceptoId: string | null;
                                /** Format: uuid */
                                segmentoId: string | null;
                                desde: number;
                                hasta: number | null;
                                /** @enum {string} */
                                tipo: "REEMPLAZA" | "ACUMULA";
                                importeFijo: number;
                                cmUnitaria: number;
                                techoFisico: number | null;
                                techoFuente: string | null;
                                /** Format: date-time */
                                techoDeclaradoEn: string | null;
                                /** Format: uuid */
                                techoDeclaradoPorId: string | null;
                                /** Format: date-time */
                                createdAt: string;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                conceptoId: string | null;
                                /** Format: uuid */
                                segmentoId: string | null;
                                desde: number;
                                hasta: number | null;
                                /** @enum {string} */
                                tipo: "REEMPLAZA" | "ACUMULA";
                                importeFijo: number;
                                cmUnitaria: number;
                                techoFisico: number | null;
                                techoFuente: string | null;
                                /** Format: date-time */
                                techoDeclaradoEn: string | null;
                                /** Format: uuid */
                                techoDeclaradoPorId: string | null;
                                /** Format: date-time */
                                createdAt: string;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/tramos-costo/equilibrio": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: uuid */
                                calculoId?: string;
                                tramos: {
                                    tramoId: string;
                                    /** @enum {string} */
                                    tipo: "REEMPLAZA" | "ACUMULA";
                                    desde: number;
                                    hasta: number | null;
                                    techo: number | null;
                                    qAritmetico: number | null;
                                    q: number | null;
                                    resultadoMaximo: number | null;
                                    motivoFueraDeTramo?: string;
                                }[];
                                transiciones: {
                                    desdeTramoId: string;
                                    haciaTramoId: string;
                                    qIndiferencia: number | null;
                                    binding: number | null;
                                    margenHastaTecho: number | null;
                                    porcentajeMargen: number | null;
                                    alertaPegadoAlTecho: boolean;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: uuid */
                                calculoId?: string;
                                tramos: {
                                    tramoId: string;
                                    /** @enum {string} */
                                    tipo: "REEMPLAZA" | "ACUMULA";
                                    desde: number;
                                    hasta: number | null;
                                    techo: number | null;
                                    qAritmetico: number | null;
                                    q: number | null;
                                    resultadoMaximo: number | null;
                                    motivoFueraDeTramo?: string;
                                }[];
                                transiciones: {
                                    desdeTramoId: string;
                                    haciaTramoId: string;
                                    qIndiferencia: number | null;
                                    binding: number | null;
                                    margenHastaTecho: number | null;
                                    porcentajeMargen: number | null;
                                    alertaPegadoAlTecho: boolean;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/preferencias": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                home: {
                                    accesosRapidos: string[];
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        home: {
                            accesosRapidos: string[];
                        };
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                home: {
                                    accesosRapidos: string[];
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/preferencias/catalogo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                clave: string;
                                etiqueta: string;
                                modulo: string;
                                porDefecto: boolean;
                                destino: string;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: uuid */
                                id: string;
                                /** Format: email */
                                email: string;
                                /** @enum {string} */
                                rol: "SUPER_ADMIN" | "EMPRESARIO" | "EMPRESA_ADMIN" | "EMPRESA_OPERATOR";
                                /** Format: uuid */
                                empresaId: string | null;
                                entidadesAutorizadas: {
                                    unidadesProductivas: {
                                        /** Format: uuid */
                                        id: string;
                                        referencia: string;
                                        etiqueta: string;
                                    }[];
                                    depositos: {
                                        /** Format: uuid */
                                        id: string;
                                        referencia: string;
                                        etiqueta: string;
                                    }[];
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/classifier/costos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    desde: string;
                    hasta: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: date-time */
                                desde: string;
                                /** Format: date-time */
                                hasta: string;
                                proveedores: {
                                    provider: string;
                                    calls: number;
                                    inputTokens: number;
                                    outputTokens: number;
                                    estimatedCost: number;
                                    costCurrency: string | null;
                                    unmeasuredCalls: number;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/alerts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: ({
                                id: string;
                                /** @enum {string} */
                                type: "MARGIN_BELOW_THRESHOLD" | "MACRO_CHANGE" | "COST_SPIKE" | "INDICADOR_FISICO";
                                message: string;
                                /** @enum {string|null} */
                                severidad: "INFO" | "ADVERTENCIA" | "CRITICA" | null;
                                indicador: string | null;
                                indicadorEtiqueta: string | null;
                                unidadValor: string | null;
                                unidadUmbral: string | null;
                                motivoNoEvaluada: string | null;
                            } & {
                                [key: string]: unknown;
                            })[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/alert-rules/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                clave: string;
                                etiqueta: string;
                                unidad: string;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/alert-rules/{id}/evaluate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: (({
                                /** @enum {string} */
                                estado: "INACTIVA";
                                /** @enum {unknown|null} */
                                alerta: "null" | null;
                            } & {
                                [key: string]: unknown;
                            }) | ({
                                /** @enum {string} */
                                estado: "NORMAL";
                                /** @enum {unknown|null} */
                                alerta: "null" | null;
                            } & {
                                [key: string]: unknown;
                            })) | ({
                                /** @enum {string} */
                                estado: "NO_EVALUABLE";
                                motivo: string;
                                alerta: {
                                    id: string;
                                    /** @enum {string} */
                                    type: "MARGIN_BELOW_THRESHOLD" | "MACRO_CHANGE" | "COST_SPIKE" | "INDICADOR_FISICO";
                                    message: string;
                                    /** @enum {string|null} */
                                    severidad: "INFO" | "ADVERTENCIA" | "CRITICA" | null;
                                    indicador: string | null;
                                    indicadorEtiqueta: string | null;
                                    unidadValor: string | null;
                                    unidadUmbral: string | null;
                                    motivoNoEvaluada: string | null;
                                } & {
                                    [key: string]: unknown;
                                };
                            } & {
                                [key: string]: unknown;
                            }) | ({
                                /** @enum {string} */
                                estado: "ALERTA";
                                hallazgo: {
                                    reglaId: string;
                                    indicador: string;
                                    /** @enum {string} */
                                    severidad: "INFO" | "ADVERTENCIA" | "CRITICA";
                                    valor: number;
                                    umbral: number;
                                    lecturasEnCondicion: number;
                                    mensaje: string;
                                    explicacion: string[];
                                } & {
                                    [key: string]: unknown;
                                };
                                alerta: {
                                    id: string;
                                    /** @enum {string} */
                                    type: "MARGIN_BELOW_THRESHOLD" | "MACRO_CHANGE" | "COST_SPIKE" | "INDICADOR_FISICO";
                                    message: string;
                                    /** @enum {string|null} */
                                    severidad: "INFO" | "ADVERTENCIA" | "CRITICA" | null;
                                    indicador: string | null;
                                    indicadorEtiqueta: string | null;
                                    unidadValor: string | null;
                                    unidadUmbral: string | null;
                                    motivoNoEvaluada: string | null;
                                } & {
                                    [key: string]: unknown;
                                };
                                entrega?: {
                                    /** @enum {string} */
                                    canal: "IN_APP" | "EMAIL";
                                } & {
                                    [key: string]: unknown;
                                };
                            } & {
                                [key: string]: unknown;
                            });
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/segmentos-analisis": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                nombre: string;
                                /** @enum {string} */
                                nivel: "empresa" | "division" | "canal" | "linea";
                                /** Format: uuid */
                                parentId: string | null;
                                /** @default false */
                                produccionConjunta: boolean;
                                precioUnitario: number | null;
                                costoVariableUnitario: number | null;
                                participacion: number;
                                costoFijoDirecto: number;
                                prorrateoIndirectos: number;
                                /** @default [] */
                                coproductos: {
                                    nombre: string;
                                    precio: number;
                                    rendimiento: number;
                                }[];
                                /** Format: uuid */
                                id: string;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        nombre: string;
                        /** @enum {string} */
                        nivel: "empresa" | "division" | "canal" | "linea";
                        /** Format: uuid */
                        parentId?: string | null;
                        /** @default false */
                        produccionConjunta?: boolean;
                        precioUnitario?: number | null;
                        costoVariableUnitario?: number | null;
                        participacion: number;
                        costoFijoDirecto: number;
                        prorrateoIndirectos: number;
                        /** @default [] */
                        coproductos?: {
                            nombre: string;
                            precio: number;
                            rendimiento: number;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Default Response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                nombre: string;
                                /** @enum {string} */
                                nivel: "empresa" | "division" | "canal" | "linea";
                                /** Format: uuid */
                                parentId: string | null;
                                /** @default false */
                                produccionConjunta: boolean;
                                precioUnitario: number | null;
                                costoVariableUnitario: number | null;
                                participacion: number;
                                costoFijoDirecto: number;
                                prorrateoIndirectos: number;
                                /** @default [] */
                                coproductos: {
                                    nombre: string;
                                    precio: number;
                                    rendimiento: number;
                                }[];
                                /** Format: uuid */
                                id: string;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/segmentos-analisis/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** @enum {boolean} */
                                eliminado: true;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        nombre?: string;
                        /** @enum {string} */
                        nivel?: "empresa" | "division" | "canal" | "linea";
                        /** Format: uuid */
                        parentId?: string | null;
                        /** @default false */
                        produccionConjunta?: boolean;
                        precioUnitario?: number | null;
                        costoVariableUnitario?: number | null;
                        participacion?: number;
                        costoFijoDirecto?: number;
                        prorrateoIndirectos?: number;
                        /** @default [] */
                        coproductos?: {
                            nombre: string;
                            precio: number;
                            rendimiento: number;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                nombre: string;
                                /** @enum {string} */
                                nivel: "empresa" | "division" | "canal" | "linea";
                                /** Format: uuid */
                                parentId: string | null;
                                /** @default false */
                                produccionConjunta: boolean;
                                precioUnitario: number | null;
                                costoVariableUnitario: number | null;
                                participacion: number;
                                costoFijoDirecto: number;
                                prorrateoIndirectos: number;
                                /** @default [] */
                                coproductos: {
                                    nombre: string;
                                    precio: number;
                                    rendimiento: number;
                                }[];
                                /** Format: uuid */
                                id: string;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/companies/{companyId}/analisis/equilibrio-sectorial": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                equilibrioGeneral: number | null;
                                segmentos: {
                                    /** Format: uuid */
                                    id: string;
                                    nombre: string;
                                    contribucionMarginalUnitaria: number;
                                    contribucionNeta: number | null;
                                    equilibrioEspecifico: number | null;
                                    equilibrioSectorial: number | null;
                                    excedente: number | null;
                                    vistaSinProrrateo: {
                                        resultado: number | null;
                                    };
                                    vistaConProrrateo: {
                                        resultado: number | null;
                                        /** @enum {boolean} */
                                        doctrinaria: false;
                                        motivo: string;
                                    };
                                    basadoEn: {
                                        participacion: number;
                                        costoFijoDirecto: number;
                                        prorrateoIndirectos: number;
                                        produccionConjunta: boolean;
                                    };
                                }[];
                                controlIndirectos: {
                                    indirectos: number;
                                    contribucionesNetas: number;
                                    diferencia: number;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/segmentos-analisis/{id}/rotaciones": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        periodoId: string;
                        rotacion: number;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                segmentoId: string;
                                /** Format: uuid */
                                periodoId: string;
                                rotacion: number;
                                /** @enum {string} */
                                origen: "DECLARADA";
                                /** Format: date-time */
                                fecha: string;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/analisis/ranking-rotacion": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    periodoId: string;
                    criterio?: "rendimiento" | "margen";
                };
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                ranking: {
                                    producto: string;
                                    margen: number;
                                    rotacion: number;
                                    rendimiento: number;
                                    /** @enum {string} */
                                    rotacionOrigen: "DECLARADA" | "DEFAULT";
                                }[];
                                /** @enum {string} */
                                criterio: "rendimiento" | "margen";
                                advertencia: string | null;
                                excluidos: {
                                    producto: string;
                                    /** @enum {string} */
                                    motivo: "ROTACION_SIN_DECLARAR";
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/analisis/capacidad-ociosa": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                corrida: {
                                    /** Format: uuid */
                                    id: string;
                                    validada: boolean;
                                    /** Format: date-time */
                                    ejecutadaEn: string;
                                } | null;
                                ociosidadR22: {
                                    valor: number | null;
                                    motivo: string | null;
                                    capacidadNormal?: number | null;
                                    actividadReal?: number | null;
                                    unidad?: string | null;
                                };
                                manoDeObra: {
                                    paidHours?: number;
                                    productiveHours?: number;
                                    chargeableHours?: number;
                                    idleHours: number;
                                    fullMod?: number;
                                    idleCost: number;
                                    applicableMod: number;
                                    hasIdleCapacity?: boolean;
                                    /** @enum {string} */
                                    destination: "absorbido-en-el-producto" | "perdida-del-periodo";
                                    breakdown: {
                                        /** @enum {string} */
                                        tipo: "tiempos-perdidos-informados" | "improductividad-oculta";
                                        label: string;
                                        hours: number;
                                        cost: number;
                                        reasons: {
                                            reason: string;
                                            hours: number;
                                            cost: number;
                                        }[];
                                    }[];
                                    alert: {
                                        /** @enum {string} */
                                        level: "advertencia" | "critico";
                                        title: string;
                                        message: string;
                                        cost: number;
                                        sharePercent: number;
                                    } | null;
                                } | null;
                                cip: {
                                    variacionPresupuesto: number;
                                    variacionVolumen: number;
                                    controlDosVias: {
                                        sobreSubaplicacion: number;
                                        diferencia: number;
                                        cierra: boolean;
                                        formula: string;
                                    };
                                };
                                tresVias: {
                                    /** @enum {boolean} */
                                    bloqueada: true;
                                    motivo: string;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/analisis/planeamiento-resultados": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        modalidad: "fisica";
                        costosFijos: number;
                        moneda: string;
                        objetivo: {
                            /** @enum {string} */
                            tipo: "resultado_absoluto";
                            importe: number;
                        } | {
                            /** @enum {string} */
                            tipo: "porcentaje_sobre_capital";
                            tasa: number;
                            capitalFijo: number;
                            capitalPorPesoCostoVariable: number;
                        } | {
                            /** @enum {string} */
                            tipo: "porcentaje_sobre_ventas";
                            tasa: number;
                        } | {
                            /** @enum {string} */
                            tipo: "porcentaje_sobre_costos";
                            tasa: number;
                        };
                        costoVariableUnitario: number;
                        precioUnitario: number;
                        unidadCantidad: string;
                    } | {
                        /** @enum {string} */
                        modalidad: "monetaria";
                        costosFijos: number;
                        moneda: string;
                        objetivo: {
                            /** @enum {string} */
                            tipo: "resultado_absoluto";
                            importe: number;
                        } | {
                            /** @enum {string} */
                            tipo: "porcentaje_sobre_capital";
                            tasa: number;
                            capitalFijo: number;
                            capitalPorPesoCostoVariable: number;
                        } | {
                            /** @enum {string} */
                            tipo: "porcentaje_sobre_ventas";
                            tasa: number;
                        } | {
                            /** @enum {string} */
                            tipo: "porcentaje_sobre_costos";
                            tasa: number;
                        };
                        margenMarcacion: number;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                cantidadNecesaria: number | null;
                                ventasNecesarias: number | null;
                                resultadoLogrado: number | null;
                                /** @enum {string} */
                                basadoEn: "resultado_absoluto" | "porcentaje_sobre_capital";
                                unidades: {
                                    cantidadNecesaria: string | null;
                                    ventasNecesarias: string;
                                    resultadoLogrado: string;
                                };
                                motivo?: string;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/analisis/punto-indiferencia": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        tipoDecision: "comparar_estructuras";
                        estructuraA: {
                            nombre: string;
                            costosFijos: number;
                            costoVariableUnitario: number;
                        };
                        estructuraB: {
                            nombre: string;
                            costosFijos: number;
                            costoVariableUnitario: number;
                        };
                        unidadCantidad: string;
                        moneda: string;
                    } | {
                        /** @enum {string} */
                        tipoDecision: "dejar_de_fabricar";
                        estructuraA: {
                            nombre: string;
                            costosFijos: number;
                            costoVariableUnitario: number;
                            costosFijosEvitables: number;
                            costoVariableUnitarioLiquidacion: number;
                        };
                        estructuraB: {
                            nombre: string;
                            costosFijos: number;
                            costoVariableUnitario: number;
                        };
                        unidadCantidad: string;
                        moneda: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                cantidadIndiferencia: number | null;
                                costoEnElPunto: number | null;
                                convieneA: {
                                    desde: number;
                                    hasta: number | null;
                                } | null;
                                convieneB: {
                                    desde: number;
                                    hasta: number | null;
                                } | null;
                                motivoSinPunto: string | null;
                                /** @enum {string} */
                                criterio: "costos_totales" | "r25_fijo_evitable_y_liquidacion";
                                unidades: {
                                    cantidad: string;
                                    costo: string;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/analisis/relacion-reemplazo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        segmentoOrigenId: string;
                        /** Format: uuid */
                        segmentoDestinoId: string;
                        cantidadOrigen: number;
                        /** @default 0 */
                        resultadoObjetivo?: number;
                        unidadCantidad: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                relacionReemplazo: number | null;
                                cantidadOrigen: number;
                                cantidadDestino: number | null;
                                resultadoCortoPlazo: number | null;
                                resultadoLargoPlazo: number | null;
                                unidades: {
                                    cantidadOrigen: string;
                                    cantidadDestino: string;
                                    resultadoCortoPlazo: string;
                                    resultadoLargoPlazo: string;
                                };
                                motivo?: string;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/analisis/mezcla-optima": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                recurso: {
                                    /** Format: uuid */
                                    id: string;
                                    clave: string;
                                    disponibleEnPeriodo: number;
                                    unidad: string;
                                    nombreUnidad: string;
                                } | null;
                                ranking: {
                                    /** Format: uuid */
                                    productoId: string;
                                    producto: string;
                                    cme: number;
                                    cm: number;
                                    consumoPorUnidad: number;
                                    demandaMaxima: number;
                                    cantidadAsignada: number;
                                    recursoAsignado: number;
                                    unidades: {
                                        cme: string;
                                        cm: string;
                                        consumoPorUnidad: string;
                                        demandaMaxima: string;
                                        cantidadAsignada: string;
                                        recursoAsignado: string;
                                    };
                                }[];
                                contribucionMarginalTotal: number | null;
                                recursoRestante: number | null;
                                motivoSinRanking: string | null;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/analisis/precio-transferencia": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    criterioDecision?: "COSTO_VARIABLE" | "MERCADO";
                };
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                equilibrioACostoVariable: number;
                                equilibrioAMercado: number;
                                diferencia: number;
                                /** @enum {string} */
                                criterioDecisionMarginal: "COSTO_VARIABLE";
                                avisoDecisionMarginal: string;
                                usoDeCadaCriterio: {
                                    COSTO_VARIABLE: string;
                                    MERCADO: string;
                                };
                                unidades: {
                                    equilibrioACostoVariable: string;
                                    equilibrioAMercado: string;
                                    diferencia: string;
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}/ordenes-trabajo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: ({
                                /** Format: uuid */
                                id: string;
                                codigo: string;
                                descripcion: string;
                                cliente: string;
                                /** @enum {string} */
                                estado: "BORRADOR" | "COTIZADA" | "APROBADA" | "EN_PRODUCCION" | "TERMINADA_TECNICA" | "PENDIENTE_CIERRE" | "CERRADA" | "CANCELADA";
                                etiquetaEstado: string;
                            } & {
                                [key: string]: unknown;
                            })[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        codigo: string;
                        descripcion: string;
                        cliente: string;
                        /** Format: uuid */
                        plantillaId?: string | null;
                        /** Format: date */
                        fechaInicio?: string | null;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: uuid */
                                id: string;
                                codigo: string;
                                descripcion: string;
                                cliente: string;
                                /** @enum {string} */
                                estado: "BORRADOR" | "COTIZADA" | "APROBADA" | "EN_PRODUCCION" | "TERMINADA_TECNICA" | "PENDIENTE_CIERRE" | "CERRADA" | "CANCELADA";
                                etiquetaEstado: string;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ordenes-trabajo/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: uuid */
                                id: string;
                                codigo: string;
                                descripcion: string;
                                cliente: string;
                                /** @enum {string} */
                                estado: "BORRADOR" | "COTIZADA" | "APROBADA" | "EN_PRODUCCION" | "TERMINADA_TECNICA" | "PENDIENTE_CIERRE" | "CERRADA" | "CANCELADA";
                                etiquetaEstado: string;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ordenes-trabajo/{id}/transiciones": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        estado: "BORRADOR" | "COTIZADA" | "APROBADA" | "EN_PRODUCCION" | "TERMINADA_TECNICA" | "PENDIENTE_CIERRE" | "CERRADA" | "CANCELADA";
                        motivo?: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: uuid */
                                id: string;
                                codigo: string;
                                descripcion: string;
                                cliente: string;
                                /** @enum {string} */
                                estado: "BORRADOR" | "COTIZADA" | "APROBADA" | "EN_PRODUCCION" | "TERMINADA_TECNICA" | "PENDIENTE_CIERRE" | "CERRADA" | "CANCELADA";
                                etiquetaEstado: string;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/empresa-portal/{companyId}/operators": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                /** Format: email */
                                email: string;
                                isActive: boolean;
                                /** Format: date-time */
                                createdAt: string;
                                alcance: {
                                    unidadesProductivas: {
                                        /** Format: uuid */
                                        id: string;
                                        referencia: string;
                                    }[];
                                    depositos: {
                                        /** Format: uuid */
                                        id: string;
                                        referencia: string;
                                    }[];
                                };
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        operatorName: string;
                        /** Format: email */
                        operatorEmail: string;
                        jobTitle?: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: email */
                                email: string;
                                tempPassword?: string;
                                inviteCode: string;
                                isNewUser: boolean;
                                emailSent: boolean;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/empresa-portal/operators/{operatorId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    operatorId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                success: boolean;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/empresa-portal/{companyId}/operators/{operatorId}/scope": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    companyId: string;
                    operatorId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @default [] */
                        unidadProductivaIds?: string[];
                        /** @default [] */
                        depositoIds?: string[];
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                success: boolean;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code?: string;
                                message: string;
                                details?: {
                                    [key: string]: unknown;
                                } | {
                                    field: string;
                                    message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
