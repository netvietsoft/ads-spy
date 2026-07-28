import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { MODULE_KEY, FEATURE_KEY } from './requires.keys';
import { ModuleGuard } from './module.guard';
import { FeatureGuard } from './feature.guard';

export const RequiresModule = (moduleKey: string) => applyDecorators(SetMetadata(MODULE_KEY, moduleKey), UseGuards(ModuleGuard));
export const RequiresFeature = (moduleKey: string, feature: string) => applyDecorators(SetMetadata(FEATURE_KEY, { moduleKey, feature }), UseGuards(FeatureGuard));
