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
