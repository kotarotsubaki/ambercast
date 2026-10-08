import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, test } from 'vitest';

/**
 * Source-contract check per #492: confirms, by parsing the producer source
 * files themselves rather than importing their types, that each actual
 * producer's AI-response-issue vocabulary carries both halves of the
 * independent subset proof the design comment requires — a central reverse
 * tripwire (`Record<Exclude<ProducerUnion, AiResponseIssueCode>, never>`)
 * and every one of that producer's own `code`-typed construction sites bound
 * to its own union rather than derived from `AiResponseIssueCode`. A type
 * test alone cannot distinguish "the guard exists" from "the guard exists
 * but nothing real is bound to it": a binding derived from the report
 * vocabulary itself, such as `Extract<AiResponseIssueCode, '...'>`, stays
 * vacuously well-typed next to an intact guard, because it is defined *in
 * terms of* the very vocabulary the guard is supposed to check it against
 * (#492). Each producer therefore
 * gets two independent presence checks below, each proven sensitive by its
 * own in-memory mutation (never a rewrite of the file on disk): removing the
 * guard's text must make the guard check report absent, and reverting one
 * binding's text back to `AiResponseIssueCode` must make the binding check
 * report absent for that producer — independently of each other, since a
 * single combined check could not tell which half had regressed.
 */

type ProducerSpec = {
  readonly name: string;
  readonly filePath: string;
  readonly producerUnion: string;
  readonly expectedBindingCount: number;
  readonly findCodeTypeNodes: (sourceFile: ts.SourceFile) => ts.TypeNode[];
};

function repoPath(relativePath: string): string {
  return fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));
}

function readSource(relativePath: string): string {
  return readFileSync(repoPath(relativePath), 'utf8');
}

function parseSource(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2023, true);
}

function isReverseGuardType(typeNode: ts.TypeNode, producerUnion: string): boolean {
  if (!ts.isTypeReferenceNode(typeNode) || typeNode.typeName.getText() !== 'Record') return false;
  const args = typeNode.typeArguments;
  if (args === undefined || args.length !== 2) return false;
  const excludeArg = args[0];
  const neverArg = args[1];
  if (excludeArg === undefined || neverArg === undefined) return false;
  if (neverArg.kind !== ts.SyntaxKind.NeverKeyword) return false;
  if (!ts.isTypeReferenceNode(excludeArg) || excludeArg.typeName.getText() !== 'Exclude') return false;
  const excludeArgs = excludeArg.typeArguments;
  if (excludeArgs === undefined || excludeArgs.length !== 2) return false;
  const excludeFirst = excludeArgs[0];
  const excludeSecond = excludeArgs[1];
  if (excludeFirst === undefined || excludeSecond === undefined) return false;
  return excludeFirst.getText() === producerUnion && excludeSecond.getText() === 'AiResponseIssueCode';
}

function hasEmptyObjectInitializer(declaration: ts.VariableDeclaration): boolean {
  return (
    declaration.initializer !== undefined
    && ts.isObjectLiteralExpression(declaration.initializer)
    && declaration.initializer.properties.length === 0
  );
}

function findReverseGuardNode(sourceFile: ts.SourceFile, producerUnion: string): ts.VariableStatement | undefined {
  let found: ts.VariableStatement | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (
          declaration.type !== undefined
          && isReverseGuardType(declaration.type, producerUnion)
          && hasEmptyObjectInitializer(declaration)
        ) {
          found = node;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function isOwnBindingType(typeNode: ts.TypeNode, producerUnion: string): boolean {
  if (typeNode.getText() === producerUnion) return true;
  if (ts.isTypeReferenceNode(typeNode) && typeNode.typeName.getText() === 'Extract') {
    const args = typeNode.typeArguments;
    return args !== undefined && args.length >= 1 && args[0]!.getText() === producerUnion;
  }
  return false;
}

function findPropertySignatureType(
  sourceFile: ts.SourceFile,
  isOwner: (node: ts.Node) => node is ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
  propertyName: string,
): ts.TypeNode[] {
  const results: ts.TypeNode[] = [];
  const membersOf = (owner: ts.InterfaceDeclaration | ts.TypeAliasDeclaration): readonly ts.TypeElement[] => (
    ts.isInterfaceDeclaration(owner) ? owner.members : (ts.isTypeLiteralNode(owner.type) ? owner.type.members : [])
  );
  const visit = (node: ts.Node): void => {
    if (isOwner(node)) {
      for (const member of membersOf(node)) {
        if (ts.isPropertySignature(member) && member.type !== undefined && member.name.getText() === propertyName) {
          results.push(member.type);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return results;
}

const elementIntentSpec: ProducerSpec = {
  name: 'element-intent-policy.ts (ElementIntentIssueCode)',
  filePath: 'src/usecases/element-intent-policy.ts',
  producerUnion: 'ElementIntentIssueCode',
  expectedBindingCount: 1,
  findCodeTypeNodes: (sourceFile) => findPropertySignatureType(
    sourceFile,
    (node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === 'ElementIntentIssue',
    'code',
  ),
};

const secretNamingSpec: ProducerSpec = {
  name: 'secret-naming.ts (SecretNamingIssueCode)',
  filePath: 'src/usecases/secret-naming.ts',
  producerUnion: 'SecretNamingIssueCode',
  expectedBindingCount: 2,
  findCodeTypeNodes: (sourceFile) => {
    const results: ts.TypeNode[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node)
        && (node.name.getText() === 'invalidIssues' || node.name.getText() === 'targetIssues')
        && node.type !== undefined
        && ts.isArrayTypeNode(node.type)
        && ts.isTypeLiteralNode(node.type.elementType)
      ) {
        for (const member of node.type.elementType.members) {
          if (ts.isPropertySignature(member) && member.type !== undefined && member.name.getText() === 'code') {
            results.push(member.type);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return results;
  },
};

const selfQuoteSpec: ProducerSpec = {
  name: 'generate.ts (TextEqualsSelfQuoteIssueCode)',
  filePath: 'src/usecases/generate.ts',
  producerUnion: 'TextEqualsSelfQuoteIssueCode',
  expectedBindingCount: 1,
  findCodeTypeNodes: (sourceFile) => findPropertySignatureType(
    sourceFile,
    (node): node is ts.TypeAliasDeclaration => (
      ts.isTypeAliasDeclaration(node) && node.name.text === 'TextEqualsSelfQuoteIssue' && ts.isTypeLiteralNode(node.type)
    ),
    'code',
  ),
};

describe.each([elementIntentSpec, secretNamingSpec, selfQuoteSpec])('$name', (spec: ProducerSpec) => {
  test('declares an independent reverse subset guard', () => {
    const sourceFile = parseSource(readSource(spec.filePath), spec.filePath);
    expect(findReverseGuardNode(sourceFile, spec.producerUnion)).toBeDefined();
  });

  test('binds every one of its own issue-code construction sites to the producer-owned union', () => {
    const sourceFile = parseSource(readSource(spec.filePath), spec.filePath);
    const codeTypeNodes = spec.findCodeTypeNodes(sourceFile);
    expect(codeTypeNodes.length).toBe(spec.expectedBindingCount);
    for (const typeNode of codeTypeNodes) {
      expect(isOwnBindingType(typeNode, spec.producerUnion)).toBe(true);
    }
  });

  test('reports the guard absent, but leaves binding detection unaffected, once the guard text is removed from an in-memory copy', () => {
    const source = readSource(spec.filePath);
    const sourceFile = parseSource(source, spec.filePath);
    const guardNode = findReverseGuardNode(sourceFile, spec.producerUnion);
    expect(guardNode).toBeDefined();
    const bindingBeforeMutation = spec.findCodeTypeNodes(sourceFile).map(
      (node) => isOwnBindingType(node, spec.producerUnion),
    );

    const mutatedSource = source.slice(0, guardNode!.getFullStart()) + source.slice(guardNode!.getEnd());
    const mutatedSourceFile = parseSource(mutatedSource, spec.filePath);
    expect(findReverseGuardNode(mutatedSourceFile, spec.producerUnion)).toBeUndefined();

    const bindingAfterMutation = spec.findCodeTypeNodes(mutatedSourceFile).map(
      (node) => isOwnBindingType(node, spec.producerUnion),
    );
    expect(bindingAfterMutation).toEqual(bindingBeforeMutation);
  });

  test('reports the first binding site absent, but leaves the guard unaffected, once that site is reverted to AiResponseIssueCode in an in-memory copy', () => {
    const source = readSource(spec.filePath);
    const sourceFile = parseSource(source, spec.filePath);
    const guardFoundBeforeMutation = findReverseGuardNode(sourceFile, spec.producerUnion) !== undefined;
    const codeTypeNodes = spec.findCodeTypeNodes(sourceFile);
    const target = codeTypeNodes[0]!;
    const mutatedSource = (
      source.slice(0, target.getStart(sourceFile)) + 'AiResponseIssueCode' + source.slice(target.getEnd())
    );
    const mutatedSourceFile = parseSource(mutatedSource, spec.filePath);
    const mutatedCodeTypeNodes = spec.findCodeTypeNodes(mutatedSourceFile);
    expect(mutatedCodeTypeNodes.length).toBe(spec.expectedBindingCount);
    expect(isOwnBindingType(mutatedCodeTypeNodes[0]!, spec.producerUnion)).toBe(false);

    const guardFoundAfterMutation = findReverseGuardNode(mutatedSourceFile, spec.producerUnion) !== undefined;
    expect(guardFoundAfterMutation).toBe(guardFoundBeforeMutation);
  });
});
