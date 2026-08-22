#!/usr/bin/env node

import { configureHttpDispatcher } from "./http-dispatcher.js";
import { createProgram } from "./program.js";

configureHttpDispatcher(process.env);
await createProgram().parseAsync(process.argv);
