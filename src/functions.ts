import { Optional, Some } from "optional-typescript";
import {
  Repository,
  getConnection,
  EntitySchema,
  FindConditions,
  DeepPartial,
  SaveOptions,
  SelectQueryBuilder,
  Brackets,
  ObjectLiteral,
  UpdateQueryBuilder,
  ObjectType,
  OrderByCondition
} from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
// import { sendEvent } from "./eventHandling";

export interface IModel {
  id: string;
}

async function getRepositoryAsync<T>(
  target: ObjectType<T> | string | Function | (new () => T) | EntitySchema<T>
): Promise<Repository<T>> {
  return getConnection().getRepository(target);
}

export async function createQueryBuilderAsync<T>({
  target,
  lockMode,
  lockVersion
}: {
  target: ObjectType<T> | string | Function | (new () => T) | EntitySchema<T>;
  lockMode?: "pessimistic_read" | "pessimistic_write" | "optimistic";
  lockVersion?: number | Date;
}): Promise<SelectQueryBuilder<T>> {
  let queryBuilder = (await getRepositoryAsync(target)).createQueryBuilder();
  if (lockMode === "optimistic") {
    if (!lockVersion) throw new Error("Lock version not specified");

    if (lockVersion instanceof Date) {
      queryBuilder = queryBuilder.setLock(lockMode, lockVersion);
    } else queryBuilder = queryBuilder.setLock(lockMode, lockVersion);
  } else if (
    lockMode === "pessimistic_read" ||
    lockMode === "pessimistic_write"
  ) {
    queryBuilder = queryBuilder.setLock(lockMode);
  }

  return queryBuilder;
}

async function simplifiedQueryBuilderAsync<T>({
  target,
  lockMode,
  lockVersion
}: {
  target: ObjectType<T> | string | Function | (new () => T) | EntitySchema<T>;
  lockMode?: "optimistic" | "pessimistic_read" | "pessimistic_write";
  lockVersion?: number | Date;
}): Promise<SelectQueryBuilder<T>> {
  if (lockMode) {
    if (lockMode === "optimistic") {
      if (lockVersion) {
        return createQueryBuilderAsync({ target, lockMode, lockVersion });
      } else return createQueryBuilderAsync({ target });
    } else return createQueryBuilderAsync({ target, lockMode });
  } else return createQueryBuilderAsync({ target });
}

async function deleteQueryBuilderAsync<T>({
  target,
  lockMode,
  lockVersion
}: {
  target: ObjectType<T> | string | Function | (new () => T) | EntitySchema<T>;
  lockMode?: "optimistic" | "pessimistic_read" | "pessimistic_write";
  lockVersion?: number | Date;
}) {
  const queryBuilder = await simplifiedQueryBuilderAsync({
    target,
    lockMode,
    lockVersion
  });
  // tslint:disable-next-line: newline-per-chained-call
  return queryBuilder.delete().from(target);
}

export async function selectQueryBuilderAsync<T>({
  target,
  where,
  parameters,
  lockMode,
  lockVersion
}: {
  target: ObjectType<T> | string | Function | (new () => T) | EntitySchema<T>;
  where:
    | Brackets
    | string
    | ((qb: SelectQueryBuilder<T>) => string)
    | ObjectLiteral
    | ObjectLiteral[];
  parameters?: ObjectLiteral;
  lockMode?: "optimistic" | "pessimistic_read" | "pessimistic_write";
  lockVersion?: number | Date;
}): Promise<SelectQueryBuilder<T>> {
  const queryBuilder = await simplifiedQueryBuilderAsync({
    target,
    lockMode,
    lockVersion
  });
  return queryBuilder.where(where, parameters);
}

export async function deleteEntriesBasedOnConditionPessimisticAsync<
  T,
  TEventResult
>({
  target,
  where,
  sendEvent,
  parameters
}: {
  target: ObjectType<T> | string | Function | (new () => T) | EntitySchema<T>;
  where:
    | Brackets
    | string
    | ((qb: SelectQueryBuilder<T>) => string)
    | ObjectLiteral
    | ObjectLiteral[];
  sendEvent?:
    | ((entry: T) => TEventResult | Promise<TEventResult>)
    | (() => TEventResult | Promise<TEventResult>);
  parameters?: ObjectLiteral;
}): Promise<T[]> {
  const entitiesBeingDeleted = await (
    await selectQueryBuilderAsync({
      target,
      where,
      parameters
    })
  ).getMany();

  if (sendEvent) {
    entitiesBeingDeleted.forEach(async entry => sendEvent(entry));
  }
  await (
    await deleteQueryBuilderAsync({
      target,
      lockMode: "pessimistic_write"
    })
  )
    .where(where, parameters)
    .execute();
  return entitiesBeingDeleted;
}

export async function updateEntriesAsync<T, TEventResult>({
  target,
  updateValues,
  where,
  sendEvent,
  parameters,
  lockMode,
  lockVersion
}: {
  target: ObjectType<T> | string | Function | (new () => T) | EntitySchema<T>;
  updateValues: QueryDeepPartialEntity<T>;
  where:
    | Brackets
    | string
    | ((qb: UpdateQueryBuilder<T>) => string)
    | ObjectLiteral
    | ObjectLiteral[];
  sendEvent?:
    | ((entry: T) => TEventResult | Promise<TEventResult>)
    | (() => TEventResult | Promise<TEventResult>);
  parameters?: ObjectLiteral;
  lockMode?: "optimistic" | "pessimistic_read" | "pessimistic_write";
  lockVersion?: number | Date;
}): Promise<T[]> {
  const queryBuilder = await simplifiedQueryBuilderAsync({
    target,
    lockMode,
    lockVersion
  });
  await queryBuilder
    .update(target)
    .set(updateValues)
    .where(where, parameters)
    .execute();
  const select = await (
    await selectQueryBuilderAsync({
      target,
      where
    })
  ).getMany();
  if (sendEvent) {
    select.forEach(async entry => sendEvent(entry));
  }
  return select;
}

interface IGetIdParams<A extends IModel, B> {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  id: string;
  createFromModel: (val: A) => B;
}

export async function getByIdAsync<A extends IModel, B>({
  target,
  id,
  createFromModel
}: IGetIdParams<A, B>): Promise<Optional<B>> {
  return findOneAsync({ target, createFromModel, condition: id });
}

export async function findOneAsync<A, B>({
  target,
  createFromModel,
  condition,
  orderByCondition
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  createFromModel: (val: A) => B;
  condition?: string | number | Date | FindConditions<A>;
  orderByCondition?: OrderByCondition;
}): Promise<Optional<B>> {
  if (
    condition instanceof Date ||
    typeof condition === "string" ||
    typeof condition === "number"
  ) {
    const repo = await getRepositoryAsync(target);
    return Some(await repo.findOne(condition)).map(createFromModel);
  } else {
    let queryBuilder = await createQueryBuilderAsync({ target });
    if (orderByCondition) {
      queryBuilder = queryBuilder.orderBy(orderByCondition);
    }
    if (condition) {
      queryBuilder = queryBuilder.where(<ObjectLiteral>condition);
    }
    return Some(await queryBuilder.getOne()).map(createFromModel);
  }
}
export async function anyAsync<A, B>({
  target,
  condition
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  condition?: FindConditions<A>;
}): Promise<boolean> {
  let queryBuilder = await createQueryBuilderAsync({ target });
  if (condition) {
    queryBuilder = queryBuilder.where(<ObjectLiteral>condition);
  }
  return (await queryBuilder.getCount()) > 0;
}

export async function findAsync<A, B>({
  target,
  createFromModel,
  findConditions,
  orderByCondition,
  takeAmount,
  skipAmount
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  createFromModel: (val: A) => B;
  findConditions?: FindConditions<A>;
  orderByCondition?: OrderByCondition;
  takeAmount?: number;
  skipAmount?: number;
}): Promise<B[]> {
  let queryBuilder = await createQueryBuilderAsync({ target });
  if (orderByCondition) {
    queryBuilder = queryBuilder.orderBy(orderByCondition);
  }
  queryBuilder = queryBuilder.where(<ObjectLiteral>findConditions);
  if (takeAmount) {
    queryBuilder = queryBuilder.take(takeAmount);
  }
  if (skipAmount) {
    queryBuilder = queryBuilder.skip(skipAmount);
  }
  return (await queryBuilder.getMany()).map(createFromModel);
}

export async function createAsync<A extends DeepPartial<A>, B, TEventResult>({
  target,
  elementsToCreate,
  createFromModel,
  sendEvent,
  options
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  elementsToCreate: A[];
  createFromModel: (entry: A) => B;
  sendEvent?:
    | ((entry: B) => TEventResult | Promise<TEventResult>)
    | (() => TEventResult | Promise<TEventResult>);
  options?: SaveOptions;
}): Promise<B[]> {
  const repo = await getRepositoryAsync(target);
  return Promise.all(
    (await repo.save(elementsToCreate, options)).map(async entry => {
      const tmp = createFromModel(entry);
      if (sendEvent) {
        await sendEvent(tmp);
      }

      return tmp;
    })
  );
}

export async function createOneAsync<
  A extends DeepPartial<A>,
  B,
  TEventResult
>({
  target,
  elementToCreate,
  createFromModel,
  sendEvent,
  options
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  elementToCreate: A;
  createFromModel: (entry: A) => B;
  sendEvent?:
    | ((entry: B) => TEventResult | Promise<TEventResult>)
    | (() => TEventResult | Promise<TEventResult>);
  options?: SaveOptions;
}): Promise<B> {
  const repo = await getRepositoryAsync(target);
  const element = createFromModel(await repo.save(elementToCreate, options));
  if (sendEvent) {
    await sendEvent(element);
  }
  return element;
}

export async function updateAsync<A, B, TEventResult>({
  target,
  criteria,
  elementToUpdate,
  retrievalFunction,
  sendEvent
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  criteria:
    | string
    | string[]
    | number
    | number[]
    | Date
    | Date[]
    | FindConditions<A>;
  elementToUpdate: DeepPartial<A>;
  retrievalFunction: () => Promise<Optional<B>>;
  sendEvent?:
    | ((entry?: B) => TEventResult | Promise<TEventResult>)
    | (() => TEventResult | Promise<TEventResult>);
}): Promise<Optional<B>> {
  const updatedEntryOrNone = await retrievalFunction();
  if (!updatedEntryOrNone.hasValue) {
    throw new Error("Not possible to update the given entity");
  }
  const repo = await getRepositoryAsync(target);
  await repo.update(criteria, elementToUpdate);
  if (sendEvent) {
    await sendEvent(updatedEntryOrNone.valueOrUndefined());
  }
  return retrievalFunction();
}

export async function updateByIdAsync<A extends IModel, B, TEventResult>({
  target,
  id,
  elementToUpdate,
  createFromModel,
  sendEvent
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  id: string;
  elementToUpdate: DeepPartial<A>;
  createFromModel: (val: A) => B;
  sendEvent?:
    | ((entry: B) => TEventResult | Promise<TEventResult>)
    | (() => TEventResult | Promise<TEventResult>);
}): Promise<Optional<B>> {
  return updateAsync({
    target,
    criteria: <FindConditions<IModel>>{ id },
    elementToUpdate: <DeepPartial<IModel>>elementToUpdate,
    retrievalFunction: () => getByIdAsync({ target, id, createFromModel }),
    sendEvent
  });
}

export async function deleteOneAsync<A, B, TEventResult>({
  target,
  criteria,
  retrievalFunction,
  sendEvent
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  criteria:
    | string
    | string[]
    | number
    | number[]
    | Date
    | Date[]
    | FindConditions<A>;
  retrievalFunction: () => Promise<Optional<B>>;
  sendEvent?:
    | ((entry?: B) => TEventResult | Promise<TEventResult>)
    | (() => TEventResult | Promise<TEventResult>);
}): Promise<Optional<B>> {
  const repo = await getRepositoryAsync(target);
  const toBeDeletedOrNone = await retrievalFunction();
  if (toBeDeletedOrNone.hasValue) {
    await repo.delete(criteria);
    if (sendEvent) {
      await sendEvent(toBeDeletedOrNone.valueOrUndefined());
    }
  }
  return toBeDeletedOrNone;
}

export async function deleteAsync<A, B, TEventResult>({
  target,
  criteria,
  retrievalFunction,
  sendEvent
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  criteria:
    | string
    | string[]
    | number
    | number[]
    | Date
    | Date[]
    | FindConditions<A>;
  retrievalFunction: () => Promise<Optional<B[]>>;
  sendEvent?:
    | ((entry?: B) => TEventResult | Promise<TEventResult>)
    | (() => TEventResult | Promise<TEventResult>);
}): Promise<B[]> {
  const repo = await getRepositoryAsync(target);
  const toBeDeletedOrNone = await retrievalFunction();
  if (toBeDeletedOrNone.hasValue) {
    await repo.delete(criteria);
    if (sendEvent) {
      if (toBeDeletedOrNone.hasValue) {
        toBeDeletedOrNone
          .valueOrFailure()
          .forEach(async val => await sendEvent(val));
      }
    }
  }
  return toBeDeletedOrNone.valueOr([]);
}

export async function deleteByIdAsync<A extends IModel, B, TEventResult>({
  target,
  id,
  createFromModel,
  sendEvent
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  id: string;
  createFromModel: (val: A) => B;
  sendEvent?:
    | ((entry?: B) => TEventResult | Promise<TEventResult>)
    | (() => TEventResult | Promise<TEventResult>);
}) {
  return deleteOneAsync({
    target,
    criteria: <FindConditions<IModel>>{ id },
    retrievalFunction: () => getByIdAsync({ target, id, createFromModel }),
    sendEvent
  });
}

export async function findByIdsAsync<A extends IModel, B>({
  target,
  createFromModel,
  ids,
  optionsOrConditions
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  createFromModel: (val: A) => B;
  ids: string[];
  optionsOrConditions?: FindConditions<A>;
}) {
  const repo = await getRepositoryAsync(target);
  return (await repo.findByIds(ids, optionsOrConditions)).map(createFromModel);
}

export async function findOneAlternativeConditionAsync<A extends IModel, B>({
  target,
  createFromModel,
  condition,
  alternativeCondition,
  orderByCondition
}: {
  target: ObjectType<A> | string | Function | (new () => A) | EntitySchema<A>;
  createFromModel: (val: A) => B;
  condition?: string | number | Date | FindConditions<A>;
  alternativeCondition?: string | number | Date | FindConditions<A>;
  orderByCondition?: OrderByCondition;
}): Promise<Optional<B>> {
  const firstOptionOrNone = await findOneAsync({
    target,
    createFromModel,
    condition,
    orderByCondition
  });
  if (firstOptionOrNone.hasValue) return firstOptionOrNone;
  return findOneAsync({
    target,
    createFromModel,
    condition: alternativeCondition,
    orderByCondition
  });
}
