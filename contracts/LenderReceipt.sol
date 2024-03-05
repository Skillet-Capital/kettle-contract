// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Strings } from '@openzeppelin/contracts/utils/Strings.sol';
import { ERC721 } from "solmate/src/tokens/ERC721.sol";

interface ILenderReceipt {
    function ownerOf(uint256 tokenId) external returns (address);
    function mint(address to, uint256 tokenId) external;
    function burn(uint256 tokenId) external;
}

/**
 * @title Kettle Lender Receipt
 * @author diamondjim.eth
 * @notice Implements the Kettle Lender Receipt ERC721
 */
contract LenderReceipt is ERC721 {
    using Strings for uint256;
    string public _baseURIextended;

    uint256 public immutable ADMIN_ROLE = 0;
    uint256 public immutable LENDER_RECEIPT_SUPPLIER = 1;
    mapping(uint256 => mapping(address => uint256)) public _roles;

    constructor() ERC721("KettleLenderReceipt", "KLR") {
        _roles[ADMIN_ROLE][msg.sender] = 1;
    }

    /*//////////////////////////////////////////////////
                ERC721 IMPLEMENTATION
    //////////////////////////////////////////////////*/

    function setBaseURI(string memory baseURI) public requiresRole(ADMIN_ROLE) {
        _baseURIextended = baseURI;
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        string memory base = _baseURI();

        // If there is no base URI, return the token URI.
        if (bytes(base).length == 0) {
            return Strings.toString(tokenId);
        }
        // If both are set, concatenate the baseURI and tokenURI (via string.concat).
        return string.concat(base, Strings.toString(tokenId));
    } 

    function _baseURI() internal view virtual returns (string memory) {
        return _baseURIextended;
    }

    function mint(
        address to, 
        uint256 tokenId
    ) external requiresRole(LENDER_RECEIPT_SUPPLIER) {
        _mint(to, tokenId);
    }

    function burn(
        uint256 tokenId
    ) external requiresRole(LENDER_RECEIPT_SUPPLIER) {
        _burn(tokenId);
    }

    /*//////////////////////////////////////////////////
                    ACCESS CONTROL
    //////////////////////////////////////////////////*/

    function setRole(uint256 role, address account, uint256 value) public requiresRole(ADMIN_ROLE) {
        _roles[role][account] = value;
    }

    function setSupplier(address supplier, uint256 value) public requiresRole(ADMIN_ROLE) {
        _roles[LENDER_RECEIPT_SUPPLIER][supplier] = value;
    }

    modifier requiresRole(uint256 role) {
        require(_roles[role][msg.sender] == 1, "AccessControl");
        _;
    }
}
