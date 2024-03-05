// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Lien, MarketOffer, LoanOffer } from "./Structs.sol";
import { CollectionMismatch, CurrencyMismatch, SizeMismatch } from "./Errors.sol";

/**
 * @title Kettle Offer Matching Policy
 * @author diamondjim.eth
 * @notice Verifies that offers match based on specific criteria
 */
contract OfferMatcher {

    /**
     * @dev Internal function to match market offer details with loan offer details.
     *
     * @param marketOffer Market offer details to compare.
     * @param loanOffer Loan offer details to compare.
     *
     * Requirements:
     * - The collateral collection in the market offer must match the collateral collection in the loan offer.
     * - The currency in the market offer must match the currency in the loan offer.
     * - The collateral size in the market offer must match the collateral size in the loan offer.
     *
     * @dev throws CollectionMismatch if the collateral collections do not match.
     * @dev throws CurrencyMismatch if the currencies do not match.
     * @dev throws SizeMismatch if the collateral sizes do not match.
     */
    function _matchMarketOfferWithLoanOffer(
        MarketOffer calldata marketOffer,
        LoanOffer calldata loanOffer
    ) internal pure {
        if (marketOffer.collateral.collection != loanOffer.collateral.collection) {
            revert CollectionMismatch();
        }

        if (marketOffer.terms.currency != loanOffer.terms.currency) {
            revert CurrencyMismatch();
        }

        if (marketOffer.collateral.size != loanOffer.collateral.size) {
            revert SizeMismatch();
        }
    }

    /**
     * @dev Internal function to match market offer details with lien details.
     *
     * @param marketOffer Market offer details to compare.
     * @param lien Lien details to compare.
     *
     * Requirements:
     * - The collateral collection in the market offer must match the collateral collection in the lien.
     * - The currency in the market offer must match the currency in the lien.
     * - The collateral size in the market offer must match the collateral size in the lien.
     *
     * @dev throws CollectionMismatch if the collateral collections do not match.
     * @dev throws CurrencyMismatch if the currencies do not match.
     * @dev throws SizeMismatch if the collateral sizes do not match.
     */
    function _matchMarketOfferWithLien(
        MarketOffer calldata marketOffer,
        Lien calldata lien
    ) internal pure {
        if (marketOffer.collateral.collection != lien.collection) {
            revert CollectionMismatch();
        }

        if (marketOffer.terms.currency != lien.currency) {
            revert CurrencyMismatch();
        }

        if (marketOffer.collateral.size != lien.size) {
            revert SizeMismatch();
        }
    }

    /**
     * @dev Internal function to match loan offer details with lien details.
     *
     * @param loanOffer Loan offer details to compare.
     * @param lien Lien details to compare.
     *
     * Requirements:
     * - The collateral collection in the loan offer must match the collateral collection in the lien.
     * - The currency in the loan offer must match the currency in the lien.
     * - The collateral size in the loan offer must match the collateral size in the lien.
     *
     * @dev throws CollectionMismatch if the collateral collections do not match.
     * @dev throws CurrencyMismatch if the currencies do not match.
     * @dev throws SizeMismatch if the collateral sizes do not match.
     */
    function _matchLoanOfferWithLien(
        LoanOffer calldata loanOffer,
        Lien calldata lien
    ) internal pure {
        if (loanOffer.collateral.collection != lien.collection) {
            revert CollectionMismatch();
        }

        if (loanOffer.terms.currency != lien.currency) {
            revert CurrencyMismatch();
        }

        if (loanOffer.collateral.size != lien.size) {
            revert SizeMismatch();
        }
    }
}
