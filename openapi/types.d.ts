export interface paths {
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
