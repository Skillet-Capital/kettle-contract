// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";

import { Collateral, LoanOfferTerms, BorrowOfferTerms, MarketOfferTerms, LoanOffer, BorrowOffer, MarketOffer } from "./Structs.sol";
import { InvalidSignature, InvalidVParameter } from "./Errors.sol";

import "hardhat/console.sol";

contract Signatures {
    bytes32 private immutable _EIP_712_DOMAIN_TYPEHASH;
    bytes32 private immutable _COLLATERAL_TYPEHASH;

    bytes32 private immutable _LOAN_OFFER_TERMS_TYPEHASH;
    bytes32 private immutable _LOAN_OFFER_TYPEHASH;
    
    bytes32 private immutable _BORROW_OFFER_TERMS_TYPEHASH;
    bytes32 private immutable _BORROW_OFFER_TYPEHASH;

    bytes32 private immutable _MARKET_OFFER_TERMS_TYPEHASH;
    bytes32 private immutable _MARKET_OFFER_TYPEHASH;

    string private constant _NAME = "Kettle";
    string private constant _VERSION = "3";

    mapping(address => uint256) public nonces;
    uint256[50] private _gap;

    constructor() {
        (
            _EIP_712_DOMAIN_TYPEHASH,
            _COLLATERAL_TYPEHASH,
            _LOAN_OFFER_TERMS_TYPEHASH,
            _LOAN_OFFER_TYPEHASH,
            _BORROW_OFFER_TERMS_TYPEHASH,
            _BORROW_OFFER_TYPEHASH,
            _MARKET_OFFER_TERMS_TYPEHASH,
            _MARKET_OFFER_TYPEHASH
        ) = _createTypeHashes();
    }

    function hashLoanOffer(LoanOffer calldata offer) external view returns (bytes32) {
        return _hashLoanOffer(offer);
    }

    function hashBorrowOffer(BorrowOffer calldata offer) external view returns (bytes32) {
        return _hashBorrowOffer(offer);
    }

    function hashMarketOffer(MarketOffer calldata offer) external view returns (bytes32) {
        return _hashMarketOffer(offer);
    }

    function _createTypeHashes()
        internal
        pure
        returns (
            bytes32 eip712DomainTypehash,
            bytes32 collateralTypehash,
            bytes32 loanOfferTermsTypehash,
            bytes32 loanOfferTypehash,
            bytes32 borrowOfferTermsTypehash,
            bytes32 borrowOfferTypehash,
            bytes32 marketOfferTermsTypehash,
            bytes32 marketOfferTypehash
        ) 
    {
        eip712DomainTypehash = keccak256(
            bytes.concat(
                "EIP712Domain(",
                "string name,",
                "string version,",
                "uint256 chainId,",
                "address verifyingContract",
                ")"
            )
        );

        bytes memory collateralTypestring = bytes.concat(
            "Collateral(",
            "address collection,",
            "uint8 criteria,",
            "uint256 identifier,",
            "uint256 size",
            ")"
        );

        collateralTypehash = keccak256(collateralTypestring);

        bytes memory loanOfferTermsTypestring = bytes.concat(
            "LoanOfferTerms(",
            "address currency,",
            "uint256 totalAmount,",
            "uint256 maxAmount,",
            "uint256 minAmount,",
            "uint256 rate,",
            "uint256 fee,",
            "uint256 period,",
            "uint256 gracePeriod,",
            "uint256 tenor",
            ")"
        );

        loanOfferTermsTypehash = keccak256(loanOfferTermsTypestring);

        loanOfferTypehash = keccak256(
            bytes.concat(
                "LoanOffer(",
                "address lender,",
                "address recipient,",
                "Collateral collateral,",
                "LoanOfferTerms terms,",
                "uint256 expiration,",
                "uint256 salt,",
                "uint256 nonce",
                ")",
                collateralTypestring,
                loanOfferTermsTypestring
            )
        );

        borrowOfferTermsTypehash = keccak256(
            bytes.concat(
                "BorrowOfferTerms(",
                "address currency,",
                "uint256 amount,",
                "uint256 rate,",
                "uint256 fee,",
                "uint256 period,",
                "uint256 gracePeriod,",
                "uint256 tenor",
                ")"
            )
        );

        borrowOfferTypehash = keccak256(
            bytes.concat(
                "BorrowOffer(",
                "address borrower,",
                "address recipient,",
                "Collateral collateral,",
                "BorrowOfferTerms terms,",
                "uint256 expiration,",
                "uint256 salt",
                ")"
            )
        );

        bytes memory marketOfferTermsTypestring = bytes.concat(
            "MarketOfferTerms(",
            "address currency,",
            "uint256 amount,",
            "bool withLoan,",
            "uint256 borrowAmount,",
            "bytes32 loanOfferHash",
            ")"
        );

        marketOfferTermsTypehash = keccak256(marketOfferTermsTypestring);

        marketOfferTypehash = keccak256(
            bytes.concat(
                "MarketOffer(",
                "uint8 side,",
                "address maker,",
                "Collateral collateral,",
                "MarketOfferTerms terms,",
                "uint256 expiration,",
                "uint256 salt,",
                "uint256 nonce",
                ")",
                collateralTypestring,
                marketOfferTermsTypestring
            )
        );
    }

    function _hashDomain(
        bytes32 eip712DomainTypehash,
        bytes32 nameHash,
        bytes32 versionHash
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    eip712DomainTypehash,
                    nameHash,
                    versionHash,
                    block.chainid,
                    address(this)
                )
            );
    }

    function _hashCollateral(
        Collateral calldata collateral
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _COLLATERAL_TYPEHASH,
                    collateral.collection,
                    collateral.criteria,
                    collateral.identifier,
                    collateral.size
                )
            );
    }

    function _hashLoanOfferTerms(
        LoanOfferTerms calldata terms
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _LOAN_OFFER_TERMS_TYPEHASH,
                    terms.currency,
                    terms.totalAmount,
                    terms.maxAmount,
                    terms.minAmount,
                    terms.rate,
                    terms.fee,
                    terms.period,
                    terms.gracePeriod,
                    terms.tenor
                )
            );
    }

    function _hashLoanOffer(
        LoanOffer calldata offer
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _LOAN_OFFER_TYPEHASH,
                    offer.lender,
                    offer.recipient,
                    _hashCollateral(offer.collateral),
                    _hashLoanOfferTerms(offer.terms),
                    offer.expiration,
                    offer.salt,
                    nonces[offer.lender]
                )
            );
    }

    function _hashBorrowOfferTerms(
        BorrowOfferTerms calldata terms
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _BORROW_OFFER_TERMS_TYPEHASH,
                    terms.currency,
                    terms.amount,
                    terms.rate,
                    terms.fee,
                    terms.period,
                    terms.gracePeriod,
                    terms.tenor
                )
            );
    }

    function _hashBorrowOffer(
        BorrowOffer calldata offer
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _BORROW_OFFER_TYPEHASH,
                    offer.borrower,
                    offer.recipient,
                    _hashCollateral(offer.collateral),
                    _hashBorrowOfferTerms(offer.terms),
                    offer.expiration,
                    offer.salt
                )
            );
    }

    function _hashMarketOfferTerms(
        MarketOfferTerms calldata terms
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _MARKET_OFFER_TERMS_TYPEHASH,
                    terms.currency,
                    terms.amount,
                    terms.withLoan,
                    terms.borrowAmount,
                    terms.loanOfferHash
                )
            );
    }

    function _hashMarketOffer(
        MarketOffer calldata offer
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _MARKET_OFFER_TYPEHASH,
                    offer.side,
                    offer.maker,
                    _hashCollateral(offer.collateral),
                    _hashMarketOfferTerms(offer.terms),
                    offer.expiration,
                    offer.salt,
                    nonces[offer.maker]
                )
            );
    }

    function _hashToSign(bytes32 hash) internal view returns (bytes32) {
        bytes32 domain = _hashDomain(
            _EIP_712_DOMAIN_TYPEHASH,
            keccak256(bytes(_NAME)),
            keccak256(bytes(_VERSION))
        );

        return keccak256(abi.encodePacked(bytes2(0x1901), domain, hash));
    }

    /**
     * @notice Verify authorization of offer
     * @param offerHash Hash of offer struct
     * @param signer signer address
     * @param signature Packed offer signature
     */
    function _verifyOfferAuthorization(
        bytes32 offerHash,
        address signer,
        bytes calldata signature
    ) internal view {
        bytes32 hashToSign = _hashToSign(offerHash);
        bytes32 r;
        bytes32 s;
        uint8 v;

        if (signer.code.length > 0) {
            console.log("HERE");
            bytes4 magicValue = IERC1271(signer).isValidSignature(
                hashToSign,
                signature
            );

            if (magicValue != IERC1271(signer).isValidSignature.selector) {
                revert InvalidSignature();
            }

            return;
        }

        // solhint-disable-next-line
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := shr(248, calldataload(add(signature.offset, 0x40)))
        }
        _verify(signer, hashToSign, v, r, s);
    }

    /**
     * @notice Verify signature of digest
     * @param signer Address of expected signer
     * @param digest Signature digest
     * @param v v parameter
     * @param r r parameter
     * @param s s parameter
     */
    function _verify(
        address signer,
        bytes32 digest,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal pure {
        if (v != 27 && v != 28) {
            revert InvalidVParameter();
        }

        address recoveredSigner = ecrecover(digest, v, r, s);
        if (recoveredSigner == address(0) || signer != recoveredSigner) {
            revert InvalidSignature();
        }
    }
}
