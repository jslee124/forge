#!/usr/bin/env node

import { configureHttpDispatcher } from "@forge/application";
import { createProgram } from "./program.js";

configureHttpDispatcher(process.env);
await createProgram().parseAsync(process.argv);
